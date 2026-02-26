/**
 * @notice Entry point for executing a single proposal against a forked mainnet
 */

import { existsSync } from 'node:fs';
import { getAddress } from 'viem';
import { generateAndSaveReports } from './presentation/report';
import { buildCoverageFromResults, buildCoverageMetadata, runChecksForChain } from './run-checks';
import type {
  AllCheckResults,
  CheckResult,
  GovernorType,
  ProposalData,
  SimulationConfig,
  SimulationConfigBase,
  SimulationData,
  SimulationResult,
} from './types';
import { cacheProposal, getCachedProposal, needsSimulation } from './utils/cache/proposalCache';
import { supportsL2Checks } from './utils/chains/capabilities';
import { getChainConfig, getClientForChain, publicClient } from './utils/clients/client';
import { handleCrossChainSimulations, simulate } from './utils/clients/tenderly';
import { DAO_NAME, GOVERNOR_ADDRESS, REPORTS_OUTPUT_DIRECTORY, SIM_NAME } from './utils/constants';
import {
  formatProposalId,
  getGovernor,
  getProposalIds,
  getTimelock,
  inferGovernorType,
} from './utils/contracts/governor';
import { PROPOSAL_STATES } from './utils/contracts/governor-bravo';

/**
 * @notice Run the complete simulation pipeline (source + cross-chain)
 */
async function runSimulationPipeline(config: SimulationConfig): Promise<SimulationResult> {
  const sourceResult = await simulate(config);
  return await handleCrossChainSimulations(sourceResult);
}

function dedupeStrings(messages: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const message of messages) {
    if (seen.has(message)) continue;
    seen.add(message);
    deduped.push(message);
  }
  return deduped;
}

function dedupeJsonValues<T>(items: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const key = JSON.stringify(item, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeCheckResult(current: CheckResult, next: CheckResult): CheckResult {
  const info = dedupeStrings([...current.info, ...next.info]);
  const warnings = dedupeStrings([...current.warnings, ...next.warnings]);
  const errors = dedupeStrings([...current.errors, ...next.errors]);

  // Treat merged checks as skipped only when all merged runs were skipped.
  const skippedReasons = [current.skipped?.reason, next.skipped?.reason].filter(
    (reason): reason is string => Boolean(reason),
  );
  const skipped =
    current.skipped && next.skipped && skippedReasons.length > 0
      ? { reason: dedupeStrings(skippedReasons).join(' | ') }
      : undefined;

  const permissionsDiffMerged = dedupeJsonValues([
    ...(current.permissionsDiff ?? []),
    ...(next.permissionsDiff ?? []),
  ]);
  const permissionsDiff = permissionsDiffMerged.length > 0 ? permissionsDiffMerged : undefined;

  let data = current.data ?? next.data;
  if (current.data !== undefined && next.data !== undefined) {
    if (Array.isArray(current.data) && Array.isArray(next.data)) {
      data = dedupeJsonValues([...current.data, ...next.data]);
    } else if (isPlainObject(current.data) && isPlainObject(next.data)) {
      data = { ...current.data, ...next.data };
    }
  }

  return {
    info,
    warnings,
    errors,
    ...(data !== undefined ? { data } : {}),
    ...(skipped ? { skipped } : {}),
    ...(permissionsDiff ? { permissionsDiff } : {}),
  };
}

function mergeAllCheckResults(current: AllCheckResults, next: AllCheckResults): AllCheckResults {
  const merged: AllCheckResults = { ...current };

  for (const [checkId, nextCheck] of Object.entries(next)) {
    const currentCheck = merged[checkId];

    if (!currentCheck) {
      merged[checkId] = nextCheck;
      continue;
    }

    merged[checkId] = {
      name: currentCheck.name || nextCheck.name,
      result: mergeCheckResult(currentCheck.result, nextCheck.result),
    };
  }

  return merged;
}

/**
 * @notice Fetch block data for proposal start and end blocks
 */
async function fetchBlockData(
  proposal: SimulationResult['proposal'],
  latestBlock: SimulationResult['latestBlock'],
) {
  const [startBlock, endBlock] = await Promise.all([
    proposal.startBlock <= (latestBlock.number ?? 0n)
      ? publicClient.getBlock({ blockNumber: proposal.startBlock })
      : null,
    proposal.endBlock <= (latestBlock.number ?? 0n)
      ? publicClient.getBlock({ blockNumber: proposal.endBlock })
      : null,
  ]);

  return {
    current: latestBlock,
    start: startBlock,
    end: endBlock,
  };
}

/**
 * @notice Process cross-chain destination simulations and run checks
 */
async function processDestinationSimulations(
  proposal: SimulationResult['proposal'],
  deps: ProposalData,
  destinationSimulations: SimulationResult['destinationSimulations'],
) {
  const destinationChecks: Record<number, AllCheckResults> = {};

  if (destinationSimulations) {
    for (const destSim of destinationSimulations) {
      if (destSim.status !== 'success' || !destSim.sim) {
        continue;
      }

      if (!supportsL2Checks(destSim.chainId)) {
        console.log(
          `[Index][L2_CHECK_SKIP] Skipping destination checks for unsupported chain ${destSim.chainId}.`,
        );
        continue;
      }

      try {
        const l2Deps = {
          ...deps,
          publicClient: getClientForChain(destSim.chainId),
          chainConfig: getChainConfig(destSim.chainId),
        };
        const checkResults = await runChecksForChain(
          proposal,
          destSim.sim,
          l2Deps,
          destSim.chainId,
          destinationSimulations,
        );
        destinationChecks[destSim.chainId] = destinationChecks[destSim.chainId]
          ? mergeAllCheckResults(destinationChecks[destSim.chainId], checkResults)
          : checkResults;
      } catch (error) {
        console.error(
          `[Index][L2_CHECK_FAILURE] Failed to run L2 checks for chain ${destSim.chainId}; continuing without destination checks for this chain.`,
          error,
        );
      }
    }
  }

  return destinationChecks;
}

/**
 * @notice Process a single simulation with checks and reporting
 */
async function processSimulation(
  config: SimulationConfig,
  governorType: GovernorType,
  fallbackDeps: ProposalData,
  simulationResult: SimulationResult,
  proposalId: string,
  proposalState: string,
  shouldCache = true,
) {
  const {
    sim,
    proposal,
    latestBlock,
    proposalCreatedBlock,
    proposalExecutedBlock,
    executor,
    deps,
    destinationSimulations,
  } = simulationResult;

  // Use deps from simulationResult if available, otherwise use fallbackDeps
  const finalDeps = deps || fallbackDeps;

  // Note: deps from simulate() already contains targets and touchedContracts
  // The fallbackDeps parameter is only used if simulationResult.deps is undefined,
  // which shouldn't happen in normal operation

  // Run checks for mainnet using runChecksForChain for consistency
  console.log(`  Running checks for proposal ${proposalId}...`);
  const mainnetResults = await runChecksForChain(
    proposal,
    sim,
    finalDeps,
    1, // Mainnet chain ID
    destinationSimulations,
  );

  // Fetch block data
  const blocks = await fetchBlockData(proposal, latestBlock);

  // Process destination simulations and run checks
  const destinationChecks = await processDestinationSimulations(
    proposal,
    finalDeps,
    destinationSimulations,
  );

  // Build coverage data - include mainnet (chainId 1) and all L2 chains
  const coverageMetadata = buildCoverageMetadata();
  const coverage = buildCoverageFromResults(mainnetResults, coverageMetadata, 1);

  // Merge L2 check coverage into the main coverage
  for (const [chainIdStr, destResults] of Object.entries(destinationChecks)) {
    const chainId = Number(chainIdStr);
    const l2Coverage = buildCoverageFromResults(destResults, coverageMetadata, chainId);

    // Append L2 checks to the main coverage
    coverage.checks.push(...l2Coverage.checks);

    // Aggregate summary totals
    coverage.summary.total += l2Coverage.summary.total;
    coverage.summary.ran += l2Coverage.summary.ran;
    coverage.summary.skipped += l2Coverage.summary.skipped;
    coverage.summary.failed += l2Coverage.summary.failed;
    coverage.summary.inferredSkips += l2Coverage.summary.inferredSkips;
  }

  // Ensure every destination chain appears in coverage, even when checks did not run.
  const coveredChainIds = new Set(Object.keys(destinationChecks).map((id) => Number(id)));
  const simsByChain = new Map<
    number,
    Array<NonNullable<SimulationResult['destinationSimulations']>[number]>
  >();
  for (const destinationSim of destinationSimulations ?? []) {
    const list = simsByChain.get(destinationSim.chainId) ?? [];
    list.push(destinationSim);
    simsByChain.set(destinationSim.chainId, list);
  }

  for (const [chainId, chainSims] of simsByChain.entries()) {
    if (coveredChainIds.has(chainId)) continue;

    let status: 'skipped' | 'failed' = 'skipped';
    let skipReason: string | undefined;

    const failures = chainSims.filter((sim) => sim.status === 'failure');
    const skips = chainSims.filter((sim) => sim.status === 'skipped');
    const successes = chainSims.filter((sim) => sim.status === 'success');

    if (failures.length > 0) {
      status = 'failed';
      const reasons = failures.map((sim) => sim.error).filter(Boolean);
      skipReason = reasons.length > 0 ? reasons.join(' | ') : 'Destination simulation failed.';
    } else if (!supportsL2Checks(chainId)) {
      status = 'skipped';
      skipReason = `L2 checks are not supported for chain ${chainId}.`;
    } else if (skips.length > 0) {
      status = 'skipped';
      const reasons = skips.map((sim) => sim.error).filter(Boolean);
      skipReason = reasons.length > 0 ? reasons.join(' | ') : 'Destination simulation skipped.';
    } else if (successes.length > 0) {
      status = 'failed';
      skipReason =
        'Destination simulation succeeded but no L2 checks were recorded for this chain.';
    } else {
      status = 'skipped';
      skipReason = 'No destination simulation result was available for this chain.';
    }

    coverage.checks.push({
      checkId: 'crossChainDestination',
      checkName: 'Cross-chain destination simulation status',
      status,
      skipReason,
      chainId,
    });
    coverage.summary.total += 1;
    if (status === 'skipped') coverage.summary.skipped += 1;
    else coverage.summary.failed += 1;
  }

  // Log coverage summary
  console.log(
    `  [Coverage] Total: ${coverage.summary.total}, Ran: ${coverage.summary.ran}, Skipped: ${coverage.summary.skipped}, Failed: ${coverage.summary.failed}`,
  );

  // Generate reports
  const dir = `./${REPORTS_OUTPUT_DIRECTORY}/${config.daoName}/${config.governorAddress}`;
  await generateAndSaveReports({
    governorType,
    blocks,
    proposal,
    checks: mainnetResults,
    outputDir: dir,
    governorAddress: config.governorAddress,
    destinationSimulations,
    destinationChecks,
    executor,
    proposalCreatedBlock,
    proposalExecutedBlock,
    chainId: finalDeps.chainConfig.chainId,
    simulationType: config.type,
    simulation: sim,
    coverage,
    daoName: config.daoName,
    contracts: sim.contracts,
    proposalState,
  });

  // Prepare simulation data
  const simulationData: SimulationData = {
    sim,
    proposal,
    latestBlock,
    config,
    deps: finalDeps,
    proposalCreatedBlock,
    proposalExecutedBlock,
    executor,
  };

  // Cache results if requested
  if (shouldCache) {
    await cacheProposal(
      config.daoName,
      config.governorAddress,
      proposal.id.toString(),
      proposalState,
      simulationData,
    );
  }

  return simulationData;
}

/**
 * @notice Simulate governance proposals and run proposal checks against them
 */
async function main() {
  // --- Run simulations ---
  // Prepare array to store all simulation outputs
  const simOutputs: SimulationData[] = [];

  let governorType: GovernorType;

  // Determine if we are running a specific simulation or all on-chain proposals for a specified governor.
  if (SIM_NAME) {
    // If a SIM_NAME is provided, we run that simulation
    const configPath = `./sims/${SIM_NAME}.sim.ts`;
    if (!existsSync(configPath)) {
      throw new Error(`Simulation config file not found for '${SIM_NAME}' at path: ${configPath}`);
    }
    const config: SimulationConfig = await import(configPath).then((d) => d.config);

    governorType = await inferGovernorType(config.governorAddress);

    // Run simulation pipeline (source + cross-chain)
    console.log(`[Index] Simulating source chain for ${SIM_NAME}...`);
    const finalResult = await runSimulationPipeline(config);
    console.log(`[Index] Cross-chain handling complete for ${SIM_NAME}.`);

    const { sim, proposal, deps } = finalResult;

    // Check if source simulation itself failed
    if (!sim.transaction.status) {
      console.error(
        `[Index][FAILURE] Source simulation failed for ${SIM_NAME}. Proceeding to checks/reporting anyway.`,
      );
    }
    // Log if destination simulation failed
    if (finalResult.crossChainFailure) {
      console.error(`[Index][FAILURE] One or more destination simulations failed for ${SIM_NAME}.`);
    }

    // 3. Process simulation (checks, reports, etc.)
    console.log(`[Index] Processing ${SIM_NAME} simulation...`);

    await processSimulation(
      config,
      governorType,
      deps, // Use deps from finalResult
      finalResult,
      proposal.id.toString(),
      'Pending', // State for custom/new simulations (not yet on-chain)
      false, // Don't cache custom simulations
    );

    console.log(`[Index] Reports saved for ${SIM_NAME}.`);
  } else {
    // If no SIM_NAME is provided, we get proposals to simulate from the chain
    if (!GOVERNOR_ADDRESS) throw new Error('Must provide a GOVERNOR_ADDRESS');
    if (!DAO_NAME) throw new Error('Must provide a DAO_NAME');

    const latestBlock = await publicClient.getBlock();
    if (!latestBlock.number) throw new Error('Failed to get latest block number');

    // Fetch all proposal IDs
    governorType = await inferGovernorType(GOVERNOR_ADDRESS);
    const proposalIds = await getProposalIds(governorType, GOVERNOR_ADDRESS, latestBlock.number);

    const states = await Promise.all(
      proposalIds.map((id) => getGovernor(governorType, GOVERNOR_ADDRESS!).read.state([id])),
    );
    const simProposals: { id: bigint; simType: SimulationConfigBase['type']; state: string }[] =
      proposalIds.map((id, i) => {
        const stateNum = String(states[i]) as keyof typeof PROPOSAL_STATES;
        const stateStr = PROPOSAL_STATES[stateNum] || 'Unknown';
        const isExecuted = stateStr === 'Executed';
        return {
          id,
          simType: isExecuted ? 'executed' : 'proposed',
          state: stateStr,
        };
      });

    // If we aren't simulating all proposals, filter down to just the active ones. For now we
    // assume we're simulating all by default
    const proposalsToSimulate: typeof simProposals = [];
    const cachedProposals: typeof simProposals = [];

    for (const simProposal of simProposals) {
      const needsSim = needsSimulation({
        daoName: DAO_NAME!,
        governorAddress: GOVERNOR_ADDRESS!,
        proposalId: simProposal.id.toString(),
        currentState: simProposal.state,
      });

      if (needsSim) {
        proposalsToSimulate.push(simProposal);
      } else {
        cachedProposals.push(simProposal);
      }
    }

    // Load cached proposals
    for (const cachedProposal of cachedProposals) {
      console.log(
        `Using cached simulation and reports for ${DAO_NAME} proposal ${cachedProposal.id}...`,
      );
      const cachedData = getCachedProposal(
        DAO_NAME,
        GOVERNOR_ADDRESS,
        cachedProposal.id.toString(),
      );

      if (cachedData) {
        const reportPath = `./${REPORTS_OUTPUT_DIRECTORY}/${DAO_NAME}/${GOVERNOR_ADDRESS}/${cachedProposal.id}.md`;
        if (existsSync(reportPath)) {
          console.log(`  Using cached report for proposal ${cachedProposal.id}`);
        } else {
          console.log(
            `  Report missing for cached proposal ${cachedProposal.id}, skipping for now.`,
          );
        }
        simOutputs.push(cachedData);
      }
    }

    // Simulate proposals that need simulation
    const numProposalsToSimulate = proposalsToSimulate.length;
    if (numProposalsToSimulate > 0) {
      console.log(
        `Simulating ${numProposalsToSimulate} ${DAO_NAME} proposals: IDs of ${proposalsToSimulate
          .map((sim) => formatProposalId(governorType, sim.id))
          .join(', ')}`,
      );

      // Generate the proposal data and dependencies needed by checks
      const proposalData: ProposalData = {
        governor: getGovernor(governorType, GOVERNOR_ADDRESS),
        timelock: await getTimelock(governorType, GOVERNOR_ADDRESS),
        publicClient,
        chainConfig: getChainConfig(1), // Mainnet chain config
        targets: [], // Will be populated from simulation
        touchedContracts: [], // Will be populated from simulation
      };

      for (const simProposal of proposalsToSimulate) {
        if (simProposal.simType === 'new')
          throw new Error('Simulation type "new" is not supported in this branch');
        // Determine if this proposal is already `executed` or currently in-progress (`proposed`)
        console.log(`  Simulating ${DAO_NAME} proposal ${simProposal.id}...`);
        const config: SimulationConfig = {
          type: simProposal.simType,
          daoName: DAO_NAME,
          governorAddress: getAddress(GOVERNOR_ADDRESS),
          governorType,
          proposalId: simProposal.id,
        };

        // Run simulation pipeline (source + cross-chain)
        console.log(`  Handling cross-chain messages for proposal ${simProposal.id}...`);
        const finalResult = await runSimulationPipeline(config);

        // Check if simulations failed
        if (!finalResult.sim.transaction.status) {
          console.error(
            `  [FAILURE] Source simulation failed for proposal ${simProposal.id}. Proceeding to checks/reporting anyway.`,
          );
        }
        if (finalResult.crossChainFailure) {
          console.error(
            `  [FAILURE] One or more destination simulations failed for proposal ${simProposal.id}.`,
          );
        }

        const simulationData = await processSimulation(
          config,
          governorType,
          proposalData,
          finalResult,
          simProposal.id.toString(),
          simProposal.state,
        );

        simOutputs.push(simulationData);
        console.log('    done');
      }
    } else {
      console.log(`No new proposals to simulate for ${DAO_NAME}`);
    }
  }

  // Remove the separate check and report generation loop since we now do it inline
  console.log('All done!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
