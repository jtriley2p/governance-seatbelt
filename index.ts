/**
 * @notice Entry point for executing a single proposal against a forked mainnet
 */

import { existsSync } from 'node:fs';
import { getAddress } from 'viem';
import { generateAndSaveReports } from './presentation/report';
import { buildCoverageFromResults, buildCoverageMetadata, runChecksForChain } from './run-checks';
import type {
  AllCheckResults,
  DerivedSimulationProvenance,
  GovernorType,
  ProposalData,
  SimulationConfig,
  SimulationConfigBase,
  SimulationData,
  SimulationResult,
} from './types';
import {
  cacheProposal,
  getCachedProposal,
  needsSimulation,
  shouldWriteCanonicalProposalCache,
} from './utils/cache/proposalCache';
import { supportsL2Checks } from './utils/chains/capabilities';
import { mergeAllCheckResults } from './utils/check-results';
import { getChainConfig, getClientForChain, publicClient } from './utils/clients/client';
import {
  type SimulationExecutionOptions,
  handleCrossChainSimulations,
  simulate,
} from './utils/clients/tenderly';
import { DAO_NAME, GOVERNOR_ADDRESS, REPORTS_OUTPUT_DIRECTORY, SIM_NAME } from './utils/constants';
import {
  formatProposalId,
  getGovernor,
  getProposalIds,
  getTimelock,
  inferGovernorType,
} from './utils/contracts/governor';
import { PROPOSAL_STATES } from './utils/contracts/governor-bravo';
import {
  buildDerivedBaselineChains,
  buildDerivedProvenance,
  buildDerivedStateByChain,
  evaluateDependencyOutcome,
} from './utils/derived-state';

interface CliOptions {
  proposalId?: bigint;
  derivedFromProposalId?: bigint;
  derivedFromSimId?: string;
}

interface DerivedContext {
  executionOptions: SimulationExecutionOptions;
  provenance: DerivedSimulationProvenance;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--proposal-id') {
      if (!next) throw new Error('Missing value for --proposal-id');
      options.proposalId = BigInt(next);
      i += 1;
      continue;
    }

    if (arg === '--derived-from-proposal-id') {
      if (!next) throw new Error('Missing value for --derived-from-proposal-id');
      options.derivedFromProposalId = BigInt(next);
      i += 1;
      continue;
    }

    if (arg === '--derived-from-sim-id') {
      if (!next) throw new Error('Missing value for --derived-from-sim-id');
      options.derivedFromSimId = next;
      i += 1;
      continue;
    }

    if (arg === '--help') {
      console.log(
        '\nSeatbelt simulation CLI options:\n  --proposal-id <id>                Run only this on-chain proposal\n  --derived-from-proposal-id <id>   Derive state from predecessor proposal before running target\n  --derived-from-sim-id <sim-name>  Derive state from predecessor local sim config (sims/<sim-name>.sim.ts)\n',
      );
      process.exit(0);
    }
  }

  if (process.env.DERIVED_FROM_PROPOSAL_ID && !options.derivedFromProposalId) {
    options.derivedFromProposalId = BigInt(process.env.DERIVED_FROM_PROPOSAL_ID);
  }

  if (process.env.DERIVED_FROM_SIM_ID && !options.derivedFromSimId) {
    options.derivedFromSimId = process.env.DERIVED_FROM_SIM_ID;
  }

  return options;
}

/**
 * @notice Run the complete simulation pipeline (source + cross-chain)
 */
async function runSimulationPipeline(
  config: SimulationConfig,
  executionOptions?: SimulationExecutionOptions,
): Promise<SimulationResult> {
  const sourceResult = await simulate(config, executionOptions);
  return await handleCrossChainSimulations(sourceResult, executionOptions);
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
  provenance?: DerivedSimulationProvenance,
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
    provenance,
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

  return {
    simulationData,
    mainnetResults,
    destinationChecks,
  };
}

async function buildProposalData(
  governorType: GovernorType,
  governorAddress: `0x${string}`,
): Promise<ProposalData> {
  return {
    governor: getGovernor(governorType, governorAddress),
    timelock: await getTimelock(governorType, governorAddress),
    publicClient,
    chainConfig: getChainConfig(1),
    targets: [],
    touchedContracts: [],
  };
}

async function getProposalConfigById(
  governorType: GovernorType,
  governorAddress: `0x${string}`,
  daoName: string,
  proposalId: bigint,
): Promise<{ config: SimulationConfig; state: string }> {
  const stateNum = await getGovernor(governorType, governorAddress).read.state([proposalId]);
  const stateKey = String(stateNum) as keyof typeof PROPOSAL_STATES;
  const state = PROPOSAL_STATES[stateKey] || 'Unknown';

  return {
    config: {
      type: state === 'Executed' ? 'executed' : 'proposed',
      daoName,
      governorAddress: getAddress(governorAddress),
      governorType,
      proposalId,
    },
    state,
  };
}

async function buildDerivedContext(params: {
  governorType: GovernorType;
  predecessorConfig: SimulationConfig;
  predecessorState: string;
  referenceSimId?: string;
}): Promise<DerivedContext | { skipReason: string }> {
  const predecessorResult = await runSimulationPipeline(params.predecessorConfig);

  const predecessorDeps = await buildProposalData(
    params.governorType,
    params.predecessorConfig.governorAddress,
  );

  const processedPredecessor = await processSimulation(
    params.predecessorConfig,
    params.governorType,
    predecessorDeps,
    predecessorResult,
    predecessorResult.proposal.id.toString(),
    params.predecessorState,
    false,
  );

  const outcome = evaluateDependencyOutcome(
    predecessorResult,
    processedPredecessor.mainnetResults,
    processedPredecessor.destinationChecks,
  );

  if (outcome.status !== 'passed') {
    return {
      skipReason: outcome.reason ?? `Dependency status was ${outcome.status}`,
    };
  }

  const referenceProposalId =
    'proposalId' in params.predecessorConfig && params.predecessorConfig.proposalId != null
      ? params.predecessorConfig.proposalId.toString()
      : undefined;

  const provenance = buildDerivedProvenance({
    outcome,
    reference: {
      proposalId: referenceProposalId,
      simulationId: params.referenceSimId ?? predecessorResult.sim.simulation.id,
    },
    baselineChains: buildDerivedBaselineChains(predecessorResult),
  });

  return {
    executionOptions: {
      derivedStateByChain: buildDerivedStateByChain(predecessorResult),
    },
    provenance,
  };
}

/**
 * @notice Simulate governance proposals and run proposal checks against them
 */
async function main() {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const simOutputs: SimulationData[] = [];

  if (cliOptions.derivedFromProposalId && cliOptions.derivedFromSimId) {
    throw new Error(
      'Choose only one dependency source: --derived-from-proposal-id or --derived-from-sim-id',
    );
  }

  let governorType: GovernorType;

  if (SIM_NAME) {
    const configPath = `./sims/${SIM_NAME}.sim.ts`;
    if (!existsSync(configPath)) {
      throw new Error(`Simulation config file not found for '${SIM_NAME}' at path: ${configPath}`);
    }

    const config: SimulationConfig = await import(configPath).then((d) => d.config);
    governorType = await inferGovernorType(config.governorAddress);

    let derivedExecutionOptions: SimulationExecutionOptions | undefined;
    let provenance: DerivedSimulationProvenance | undefined;

    if (cliOptions.derivedFromSimId) {
      const predecessorPath = `./sims/${cliOptions.derivedFromSimId}.sim.ts`;
      if (!existsSync(predecessorPath)) {
        throw new Error(`Dependency sim config not found: ${predecessorPath}`);
      }

      const predecessorConfig: SimulationConfig = await import(predecessorPath).then(
        (d) => d.config,
      );
      const derivedContext = await buildDerivedContext({
        governorType,
        predecessorConfig,
        predecessorState: 'Pending',
        referenceSimId: cliOptions.derivedFromSimId,
      });

      if ('skipReason' in derivedContext) {
        console.warn(`[Index][DERIVED_SKIP] ${derivedContext.skipReason}`);
        return;
      }

      derivedExecutionOptions = derivedContext.executionOptions;
      provenance = derivedContext.provenance;
    }

    if (cliOptions.derivedFromProposalId) {
      const predecessor = await getProposalConfigById(
        governorType,
        config.governorAddress,
        config.daoName,
        cliOptions.derivedFromProposalId,
      );

      const derivedContext = await buildDerivedContext({
        governorType,
        predecessorConfig: predecessor.config,
        predecessorState: predecessor.state,
      });

      if ('skipReason' in derivedContext) {
        console.warn(`[Index][DERIVED_SKIP] ${derivedContext.skipReason}`);
        return;
      }

      derivedExecutionOptions = derivedContext.executionOptions;
      provenance = derivedContext.provenance;
    }

    console.log(`[Index] Simulating source chain for ${SIM_NAME}...`);
    const finalResult = await runSimulationPipeline(config, derivedExecutionOptions);
    console.log(`[Index] Cross-chain handling complete for ${SIM_NAME}.`);

    const { sim, proposal, deps } = finalResult;

    if (!sim.transaction.status) {
      console.error(
        `[Index][FAILURE] Source simulation failed for ${SIM_NAME}. Proceeding to checks/reporting anyway.`,
      );
    }

    if (finalResult.crossChainFailure) {
      console.error(`[Index][FAILURE] One or more destination simulations failed for ${SIM_NAME}.`);
    }

    console.log(`[Index] Processing ${SIM_NAME} simulation...`);
    await processSimulation(
      config,
      governorType,
      deps,
      finalResult,
      proposal.id.toString(),
      'Pending',
      false,
      provenance,
    );

    console.log(`[Index] Reports saved for ${SIM_NAME}.`);
  } else {
    if (!GOVERNOR_ADDRESS) throw new Error('Must provide a GOVERNOR_ADDRESS');
    if (!DAO_NAME) throw new Error('Must provide a DAO_NAME');

    const governorAddress = getAddress(GOVERNOR_ADDRESS);
    const daoName = DAO_NAME;

    governorType = await inferGovernorType(governorAddress);

    let derivedExecutionOptions: SimulationExecutionOptions | undefined;
    let provenance: DerivedSimulationProvenance | undefined;

    if (cliOptions.derivedFromSimId) {
      const predecessorPath = `./sims/${cliOptions.derivedFromSimId}.sim.ts`;
      if (!existsSync(predecessorPath)) {
        throw new Error(`Dependency sim config not found: ${predecessorPath}`);
      }

      const predecessorConfig: SimulationConfig = await import(predecessorPath).then(
        (d) => d.config,
      );
      const derivedContext = await buildDerivedContext({
        governorType,
        predecessorConfig,
        predecessorState: 'Pending',
        referenceSimId: cliOptions.derivedFromSimId,
      });

      if ('skipReason' in derivedContext) {
        console.warn(`[Index][DERIVED_SKIP] ${derivedContext.skipReason}`);
        return;
      }

      derivedExecutionOptions = derivedContext.executionOptions;
      provenance = derivedContext.provenance;
    }

    if (cliOptions.derivedFromProposalId) {
      const predecessor = await getProposalConfigById(
        governorType,
        governorAddress,
        daoName,
        cliOptions.derivedFromProposalId,
      );

      const derivedContext = await buildDerivedContext({
        governorType,
        predecessorConfig: predecessor.config,
        predecessorState: predecessor.state,
      });

      if ('skipReason' in derivedContext) {
        console.warn(`[Index][DERIVED_SKIP] ${derivedContext.skipReason}`);
        return;
      }

      derivedExecutionOptions = derivedContext.executionOptions;
      provenance = derivedContext.provenance;
    }

    if (
      (cliOptions.derivedFromProposalId || cliOptions.derivedFromSimId) &&
      !cliOptions.proposalId
    ) {
      throw new Error('Derived runs require --proposal-id <id> for the dependent proposal');
    }

    const latestBlock = await publicClient.getBlock();
    if (!latestBlock.number) throw new Error('Failed to get latest block number');

    const proposalIds = cliOptions.proposalId
      ? [cliOptions.proposalId]
      : await getProposalIds(governorType, governorAddress, latestBlock.number);

    const states = await Promise.all(
      proposalIds.map((id) => getGovernor(governorType, governorAddress).read.state([id])),
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

    const proposalsToSimulate: typeof simProposals = [];
    const cachedProposals: typeof simProposals = [];
    const shouldCacheCanonicalProposal = shouldWriteCanonicalProposalCache(derivedExecutionOptions);
    const bypassCache = !shouldCacheCanonicalProposal;

    for (const simProposal of simProposals) {
      const needsSim =
        bypassCache ||
        needsSimulation({
          daoName,
          governorAddress,
          proposalId: simProposal.id.toString(),
          currentState: simProposal.state,
        });

      if (needsSim) {
        proposalsToSimulate.push(simProposal);
      } else {
        cachedProposals.push(simProposal);
      }
    }

    for (const cachedProposal of cachedProposals) {
      console.log(
        `Using cached simulation and reports for ${daoName} proposal ${cachedProposal.id}...`,
      );
      const cachedData = getCachedProposal(daoName, governorAddress, cachedProposal.id.toString());

      if (!cachedData) continue;

      const reportPath = `./${REPORTS_OUTPUT_DIRECTORY}/${daoName}/${governorAddress}/${cachedProposal.id}.md`;
      if (existsSync(reportPath)) {
        console.log(`  Using cached report for proposal ${cachedProposal.id}`);
      } else {
        console.log(`  Report missing for cached proposal ${cachedProposal.id}, skipping for now.`);
      }
      simOutputs.push(cachedData);
    }

    if (proposalsToSimulate.length > 0) {
      console.log(
        `Simulating ${proposalsToSimulate.length} ${daoName} proposals: IDs of ${proposalsToSimulate
          .map((sim) => formatProposalId(governorType, sim.id))
          .join(', ')}`,
      );

      const proposalData = await buildProposalData(governorType, governorAddress);

      for (const simProposal of proposalsToSimulate) {
        if (simProposal.simType === 'new') {
          throw new Error('Simulation type "new" is not supported in this branch');
        }

        console.log(`  Simulating ${daoName} proposal ${simProposal.id}...`);
        const config: SimulationConfig = {
          type: simProposal.simType,
          daoName,
          governorAddress,
          governorType,
          proposalId: simProposal.id,
        };

        console.log(`  Handling cross-chain messages for proposal ${simProposal.id}...`);
        const finalResult = await runSimulationPipeline(config, derivedExecutionOptions);

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

        const processed = await processSimulation(
          config,
          governorType,
          proposalData,
          finalResult,
          simProposal.id.toString(),
          simProposal.state,
          shouldCacheCanonicalProposal,
          provenance,
        );

        simOutputs.push(processed.simulationData);
        console.log('    done');
      }
    } else {
      console.log(`No new proposals to simulate for ${daoName}`);
    }
  }

  console.log('All done!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
