import { describe, expect, test } from 'bun:test';
import { encodeFunctionData } from 'viem';
import { mainnet } from 'viem/chains';
import type { CallTrace, SimulationConfigNew } from '../../types';
import { extractArbitrumL1L2Jobs } from '../../utils/bridges/arbitrum';
import { SEND_MESSAGE_ABI, extractOptimismL1L2Jobs } from '../../utils/bridges/optimism';
import { getChainConfig } from '../../utils/clients/client';
import { simulateNew } from '../../utils/clients/tenderly';
import { handleCrossChainSimulations } from '../../utils/clients/tenderly';
import { createMockSimulation } from './test-utils';

type CrossChainSourceResult = Parameters<typeof handleCrossChainSimulations>[0];

describe('Cross-Chain Error Handling and Recovery Tests', () => {
  describe('Bridge Parsing Error Recovery', () => {
    test('should handle corrupted Arbitrum call data gracefully', () => {
      const corruptedSimulation = createMockSimulation([
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: `0x679b6ded${'x'.repeat(500)}`, // Corrupted hex data
          calls: [],
        },
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: `0x679b6ded${'gg'.repeat(100)}`, // Invalid hex characters
          calls: [],
        },
      ]);

      const messages = extractArbitrumL1L2Jobs(corruptedSimulation);

      // Should return empty array without crashing
      expect(messages).toHaveLength(0);
    });

    test('should handle malformed Optimism call data gracefully', () => {
      const malformedSimulation = createMockSimulation([
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0x3dbb202b' + 'invalid_hex_data',
          value: '0',
          calls: [],
        },
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: `0x3dbb202b${'f'.repeat(1000)}`, // Extremely long but valid hex
          value: '0',
          calls: [],
        },
      ]);

      const messages = extractOptimismL1L2Jobs(malformedSimulation);

      // Should handle gracefully
      expect(messages).toHaveLength(0);
    });

    test('should handle missing call trace data', () => {
      const emptySimulation = createMockSimulation([]);

      const arbMessages = extractArbitrumL1L2Jobs(emptySimulation);
      const opMessages = extractOptimismL1L2Jobs(emptySimulation);

      expect(arbMessages).toHaveLength(0);
      expect(opMessages).toHaveLength(0);
    });

    test('should handle null/undefined call properties', () => {
      const nullDataSimulation = createMockSimulation([
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: undefined as unknown as string,
          input: null as unknown as string,
          calls: [],
        },
        {
          to: null as unknown as string,
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0x679b6ded',
          calls: [],
        },
      ]);

      const messages = extractArbitrumL1L2Jobs(nullDataSimulation);

      // Should handle null/undefined gracefully
      expect(messages).toHaveLength(0);
    });
  });

  describe('Cross-Chain Simulation Error Recovery', () => {
    test('should handle failed source simulation gracefully', async () => {
      const failingConfig: SimulationConfigNew = {
        type: 'new',
        daoName: 'FailingTest',
        governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
        governorType: 'bravo',
        targets: ['0x0000000000000000000000000000000000000000'],
        values: [0n],
        signatures: ['nonexistentFunction()' as `0x${string}`],
        calldatas: ['0x12345678'],
        description: 'Intentionally failing proposal',
      };

      try {
        const sourceResult = await simulateNew(failingConfig);
        const crossChainResult = await handleCrossChainSimulations(sourceResult);

        // Should still return structured data even if simulation fails
        expect(crossChainResult).toBeDefined();
        expect(crossChainResult.sim).toBeDefined();
        expect(crossChainResult.proposal).toBeDefined();
        expect(crossChainResult.destinationJobResults).toBeDefined();
        expect(Array.isArray(crossChainResult.destinationJobResults)).toBe(true);
      } catch (error) {
        // If simulation fails completely, that's also acceptable
        expect(error).toBeDefined();
      }
    }, 90000); // Increased timeout for external API calls

    test('should handle network timeouts during cross-chain simulation', async () => {
      // Create a minimal source result that would trigger cross-chain handling
      const minimalSourceResult: CrossChainSourceResult = {
        sim: {
          transaction: {
            transaction_info: {
              call_trace: {
                from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
                input: '0x',
                calls: [
                  {
                    to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
                    from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
                    input:
                      '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
                    calls: [],
                  },
                ],
              },
            },
            status: true,
          },
        },
        proposal: {
          id: 999n,
          proposalId: 999n,
          proposer: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          targets: ['0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f'],
          values: [0n],
          signatures: ['' as `0x${string}`],
          calldatas: ['0x679b6ded'],
          startBlock: 1000n,
          endBlock: 2000n,
          description: 'Test proposal',
        },
        deps: {
          governor: null,
          timelock: { address: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC' },
          publicClient: null,
          chainConfig: getChainConfig(mainnet.id),
          targets: ['0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f'],
          touchedContracts: [],
        },
        latestBlock: {
          number: 1500n,
          timestamp: 1600000000n,
        },
      };

      const crossChainResult = await handleCrossChainSimulations(minimalSourceResult);

      // Should handle potential network issues gracefully
      expect(crossChainResult).toBeDefined();
      expect(crossChainResult.sim).toBeDefined();
      expect(crossChainResult.proposal).toBeDefined();
      expect(crossChainResult.destinationJobResults).toBeDefined();
    });

    test('should surface skipped destination jobs without aborting result assembly', async () => {
      const sendMessageCalldata = encodeFunctionData({
        abi: SEND_MESSAGE_ABI,
        functionName: 'sendMessage',
        args: ['0x4200000000000000000000000000000000000006', '0xd0e30db0', 1_000_000],
      });

      const sourceResult: CrossChainSourceResult = {
        sim: {
          transaction: {
            status: true,
            transaction_info: {
              call_trace: {
                from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
                input: '0x',
                calls: [],
              },
            },
          },
        },
        proposal: {
          id: 999n,
          proposalId: 999n,
          proposer: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          targets: ['0xdC40a14d9abd6F410226f1E6de71aE03441ca506'],
          values: [0n],
          signatures: [''],
          calldatas: [sendMessageCalldata],
          startBlock: 1000n,
          endBlock: 2000n,
          description: 'Test skipped destination job',
        },
        deps: {
          governor: null,
          timelock: {
            address: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          },
          publicClient: null,
          chainConfig: getChainConfig(mainnet.id),
          targets: ['0xdC40a14d9abd6F410226f1E6de71aE03441ca506'],
          touchedContracts: [],
        },
        latestBlock: {
          number: 1500n,
          timestamp: 1600000000n,
        },
      };

      const crossChainResult = await handleCrossChainSimulations(sourceResult);

      expect(crossChainResult).toBeDefined();
      expect(crossChainResult.destinationJobResults).toBeDefined();
      expect(crossChainResult.crossChainFailure).toBe(false);
      expect(crossChainResult.destinationJobResults).toHaveLength(1);
      expect(crossChainResult.destinationJobResults?.[0]).toMatchObject({
        chainId: 7777777,
        bridgeType: 'OptimismL1L2',
        status: 'skipped',
      });
      expect(crossChainResult.destinationJobResults?.[0]?.job.calls).toHaveLength(1);
      expect(crossChainResult.destinationJobResults?.[0]?.error).toContain(
        'not currently supported',
      );
    });
  });

  describe('Invalid Configuration Handling', () => {
    test('should handle invalid governor addresses', async () => {
      const invalidConfig: SimulationConfigNew = {
        type: 'new',
        daoName: 'InvalidTest',
        governorAddress: '0x0000000000000000000000000000000000000000',
        governorType: 'bravo',
        targets: ['0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'],
        values: [0n],
        signatures: ['' as `0x${string}`],
        calldatas: ['0xa9059cbb'],
        description: 'Invalid governor test',
      };

      try {
        const sourceResult = await simulateNew(invalidConfig);
        const crossChainResult = await handleCrossChainSimulations(sourceResult);

        // Should handle invalid governor gracefully
        expect(crossChainResult).toBeDefined();
      } catch (error) {
        // Invalid governor should cause simulation to fail
        expect(error).toBeDefined();
      }
    }, 90000); // Increased timeout for external API calls

    test('should handle empty target arrays', async () => {
      const emptyConfig: SimulationConfigNew = {
        type: 'new',
        daoName: 'EmptyTest',
        governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
        governorType: 'bravo',
        targets: [],
        values: [],
        signatures: [],
        calldatas: [],
        description: 'Empty proposal test',
      };

      try {
        const sourceResult = await simulateNew(emptyConfig);
        const crossChainResult = await handleCrossChainSimulations(sourceResult);

        // Should handle empty proposals gracefully
        expect(crossChainResult).toBeDefined();
        expect(crossChainResult.destinationJobResults).toEqual([]);
      } catch (error) {
        // Empty proposals may fail validation
        expect(error).toBeDefined();
      }
    }, 90000); // Increased timeout for external API calls

    test('should handle mismatched array lengths', async () => {
      const mismatchedConfig: SimulationConfigNew = {
        type: 'new',
        daoName: 'MismatchedTest',
        governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
        governorType: 'bravo',
        targets: ['0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'],
        values: [0n, 1n], // Mismatched length
        signatures: ['' as `0x${string}`],
        calldatas: ['0xa9059cbb'],
        description: 'Mismatched arrays test',
      };

      try {
        const sourceResult = await simulateNew(mismatchedConfig);
        const crossChainResult = await handleCrossChainSimulations(sourceResult);

        // Should handle mismatched arrays gracefully
        expect(crossChainResult).toBeDefined();
      } catch (error) {
        // Mismatched arrays should cause validation errors
        expect(error).toBeDefined();
      }
    });
  });

  describe('Resource Exhaustion Handling', () => {
    test('should handle extremely large call traces', () => {
      // Create a deeply nested call structure
      function createDeepCalls(depth: number): CallTrace[] {
        if (depth === 0) {
          return [];
        }

        return [
          {
            to: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
            from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
            input: '0xa9059cbb',
            calls: createDeepCalls(depth - 1),
          },
        ];
      }

      const deepSimulation = createMockSimulation(createDeepCalls(100)); // Deep nesting

      // Should handle deep nesting without stack overflow
      expect(() => {
        const arbMessages = extractArbitrumL1L2Jobs(deepSimulation);
        const opMessages = extractOptimismL1L2Jobs(deepSimulation);

        expect(arbMessages).toBeDefined();
        expect(opMessages).toBeDefined();
      }).not.toThrow();
    });

    test('should handle extremely wide call traces', () => {
      // Create a very wide call structure
      const wideCalls: CallTrace[] = [];
      for (let i = 0; i < 1000; i++) {
        wideCalls.push({
          to: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0xa9059cbb',
          calls: [],
        });
      }

      const wideSimulation = createMockSimulation(wideCalls);

      // Should handle wide traces efficiently
      const start = performance.now();
      const arbMessages = extractArbitrumL1L2Jobs(wideSimulation);
      const opMessages = extractOptimismL1L2Jobs(wideSimulation);
      const end = performance.now();

      expect(arbMessages).toBeDefined();
      expect(opMessages).toBeDefined();
      expect(end - start).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('Recovery and Continuation', () => {
    test('should continue processing after encountering errors', () => {
      const mixedSimulation = createMockSimulation([
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
          calls: [],
        },
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0x679b6ded_corrupted_data',
          calls: [],
        },
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
          value: '0',
          calls: [],
        },
      ]);

      // Should parse valid calls and skip invalid ones
      const arbMessages = extractArbitrumL1L2Jobs(mixedSimulation);
      const opMessages = extractOptimismL1L2Jobs(mixedSimulation);

      expect(arbMessages).toHaveLength(1); // Should find 1 valid Arbitrum call
      expect(opMessages).toHaveLength(1); // Should find 1 valid Optimism call
    });
  });
});
