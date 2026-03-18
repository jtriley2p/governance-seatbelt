import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type UploadRuntimeOverrides, runUpload } from '../scripts/upload';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string field ${key}`);
  }
  return value;
}

function readLogEntry(logPath: string): Record<string, unknown> {
  const logLines = readFileSync(logPath, 'utf8').trim().split('\n');
  expect(logLines.length).toBe(1);

  const parsed = JSON.parse(logLines[0]);
  if (!isRecord(parsed)) {
    throw new Error('Expected log entry to be an object');
  }

  return parsed;
}

async function runWithCapturedConsole(
  argv: string[],
  overrides: UploadRuntimeOverrides,
): Promise<{
  code: number;
  logs: string[];
  errors: string[];
}> {
  const logs: string[] = [];
  const errors: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;

  const captureLog: typeof console.log = (...args) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  };

  const captureError: typeof console.error = (...args) => {
    errors.push(args.map((arg) => String(arg)).join(' '));
  };

  console.log = captureLog;
  console.error = captureError;

  try {
    const code = await runUpload(argv, overrides);
    return { code, logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function fixturePath(name: string): string {
  return join(__dirname, 'fixtures', 'upload', name);
}

function createFrontendFixture(rootDir: string): string {
  const frontendDir = join(rootDir, 'frontend-source');
  const srcAppDir = join(frontendDir, 'src', 'app');
  const publicDir = join(frontendDir, 'public');

  mkdirSync(srcAppDir, { recursive: true });
  mkdirSync(publicDir, { recursive: true });

  writeFileSync(join(frontendDir, 'package.json'), '{"name":"fixture-frontend"}\n');
  writeFileSync(join(srcAppDir, 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(join(publicDir, 'placeholder.txt'), 'placeholder\n');

  writeFileSync(join(frontendDir, '.gitignore'), 'public/simulation-results.json\n');

  mkdirSync(join(frontendDir, '.next'), { recursive: true });
  writeFileSync(join(frontendDir, '.next', 'trace.txt'), 'do-not-copy\n');

  mkdirSync(join(frontendDir, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(join(frontendDir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = {}\n');

  mkdirSync(join(frontendDir, '.vercel'), { recursive: true });
  writeFileSync(join(frontendDir, '.vercel', 'stale-project.json'), '{}\n');

  return frontendDir;
}

describe('bun upload command', () => {
  it('writes publish metadata log for valid artifacts in validate-only mode', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    const result = await runUpload([
      '--artifact',
      artifactPath,
      '--validate-only',
      '--log',
      logPath,
    ]);

    expect(result).toBe(0);
    expect(existsSync(logPath)).toBe(true);

    const parsedLogEntry = readLogEntry(logPath);

    const publishId = readStringField(parsedLogEntry, 'publish_id');
    const publishedAt = readStringField(parsedLogEntry, 'published_at');
    const artifactHash = readStringField(parsedLogEntry, 'artifact_hash');
    const simulationType = readStringField(parsedLogEntry, 'simulation_type');
    const mode = readStringField(parsedLogEntry, 'mode');

    expect(publishId.length).toBeGreaterThan(0);
    expect(publishedAt.length).toBeGreaterThan(0);
    expect(artifactHash.length).toBe(64);
    expect(simulationType).toBe('proposed');
    expect(mode).toBe('validate-only');
  });

  it('blocks invalid artifacts', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-invalid-'));
    const artifactPath = fixturePath('simulation-results.invalid.missing-schema-version.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    const result = await runUpload([
      '--artifact',
      artifactPath,
      '--validate-only',
      '--log',
      logPath,
    ]);

    expect(result).toBe(1);
    expect(existsSync(logPath)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Managed relay publish (default path)
  // -----------------------------------------------------------------------

  it('defaults to managed relay and calls relay endpoint on --publish', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-managed-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let relayCallCount = 0;

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--log', logPath],
      {
        env: {},
        runManagedRelay: async (input) => {
          relayCallCount += 1;
          expect(input.endpointUrl).toContain('/api/v1/publishes');
          expect(input.artifactRaw.length).toBeGreaterThan(0);
          expect(input.publishLogEntry.artifact_hash.length).toBe(64);
          return {
            deploymentUrl: 'https://seatbelt-managed-default.vercel.app',
            artifactUrl: 'https://seatbelt-managed-default.vercel.app/simulation-results.json',
            metadataUrl: 'https://seatbelt-managed-default.vercel.app/publish-metadata.json',
            publishId: 'relay-pub-123',
          };
        },
      },
    );

    expect(runResult.code).toBe(0);
    expect(relayCallCount).toBe(1);

    const joinedLogs = runResult.logs.join('\n');
    expect(joinedLogs).toContain('managed relay (default)');
    expect(joinedLogs).toContain('https://seatbelt-managed-default.vercel.app');
    expect(joinedLogs).toContain('Publish ID: relay-pub-123');

    const parsedLogEntry = readLogEntry(logPath);
    expect(readStringField(parsedLogEntry, 'mode')).toBe('managed-relay');
  });

  it('strips markdown reports before sending managed relay payloads', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-managed-strip-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let publishedArtifactRaw = '';

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--log', logPath],
      {
        env: {},
        runManagedRelay: async (input) => {
          publishedArtifactRaw = input.artifactRaw;
          return {
            deploymentUrl: 'https://seatbelt-managed-strip.vercel.app',
          };
        },
      },
    );

    expect(runResult.code).toBe(0);
    expect(publishedArtifactRaw.length).toBeGreaterThan(0);

    const publishedArtifact = JSON.parse(publishedArtifactRaw);
    const normalized = Array.isArray(publishedArtifact) ? publishedArtifact : [publishedArtifact];

    expect(normalized[0]?.report?.markdownReport).toBe('');
  });

  it('uses custom relay URL from --relay-url', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-custom-relay-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let capturedEndpoint = '';

    const runResult = await runWithCapturedConsole(
      [
        '--artifact',
        artifactPath,
        '--publish',
        '--relay-url',
        'http://localhost:9999',
        '--log',
        logPath,
      ],
      {
        env: {},
        runManagedRelay: async (input) => {
          capturedEndpoint = input.endpointUrl;
          return {
            deploymentUrl: 'https://custom-relay.vercel.app',
          };
        },
      },
    );

    expect(runResult.code).toBe(0);
    expect(capturedEndpoint).toBe('http://localhost:9999/api/v1/publishes');
  });

  it('uses SEATBELT_RELAY_URL env when no --relay-url flag', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-env-relay-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let capturedEndpoint = '';

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--log', logPath],
      {
        env: {
          SEATBELT_RELAY_URL: 'http://env-relay.example.com',
        },
        runManagedRelay: async (input) => {
          capturedEndpoint = input.endpointUrl;
          return {
            deploymentUrl: 'https://env-relay.vercel.app',
          };
        },
      },
    );

    expect(runResult.code).toBe(0);
    expect(capturedEndpoint).toBe('http://env-relay.example.com/api/v1/publishes');
  });

  it('surfaces managed relay publish errors', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-relay-fail-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--log', logPath],
      {
        env: {},
        runManagedRelay: async () => {
          throw new Error('Publish was rate-limited (HTTP 429). Please wait and retry.');
        },
      },
    );

    expect(runResult.code).toBe(1);
    expect(runResult.errors.join('\n')).toContain('rate-limited');
    expect(existsSync(logPath)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // BYO Vercel publish (break-glass fallback)
  // -----------------------------------------------------------------------

  it('routes to BYO Vercel with --publish-provider vercel', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-byo-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let relayCallCount = 0;
    let vercelCommandCount = 0;

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--publish-provider', 'vercel', '--log', logPath],
      {
        env: {
          VERCEL_TOKEN: 'test_token',
          VERCEL_PROJECT_ID: 'prj_123',
          VERCEL_ORG_ID: 'team_456',
        },
        runCommand: async () => {
          vercelCommandCount += 1;
          return {
            exitCode: 0,
            stdout: 'Production: https://seatbelt-byo-fallback.vercel.app',
            stderr: '',
          };
        },
        runManagedRelay: async () => {
          relayCallCount += 1;
          return { deploymentUrl: 'https://should-not-run.vercel.app' };
        },
      },
    );

    expect(runResult.code).toBe(0);
    expect(relayCallCount).toBe(0);
    expect(vercelCommandCount).toBe(1);

    const joinedLogs = runResult.logs.join('\n');
    expect(joinedLogs).toContain('BYO Vercel (break-glass)');
    expect(joinedLogs).toContain('https://seatbelt-byo-fallback.vercel.app');

    const parsedLogEntry = readLogEntry(logPath);
    expect(readStringField(parsedLogEntry, 'mode')).toBe('byo-vercel');
  });

  it('fails with actionable error when BYO Vercel env vars are missing', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-byo-missing-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let commandCalled = false;

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--publish-provider', 'vercel', '--log', logPath],
      {
        env: {},
        runCommand: async () => {
          commandCalled = true;
          return {
            exitCode: 0,
            stdout: 'https://unused.vercel.app',
            stderr: '',
          };
        },
      },
    );

    expect(runResult.code).toBe(1);
    expect(commandCalled).toBe(false);
    expect(runResult.errors.join('\n')).toContain('VERCEL_TOKEN');
    expect(existsSync(logPath)).toBe(true);
  });

  it('includes publish artifacts and excludes bulky local directories in deploy prep', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-publish-filtering-'));
    const artifactPath = fixturePath('simulation-results.executed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');
    const frontendSourceDir = createFrontendFixture(tempDir);

    let commandInvocationCount = 0;

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--publish-provider', 'vercel', '--log', logPath],
      {
        frontendSourceDir,
        env: {
          VERCEL_TOKEN: 'test_token',
          VERCEL_PROJECT_ID: 'prj_123',
          VERCEL_ORG_ID: 'team_456',
        },
        runCommand: async (command, args, options) => {
          commandInvocationCount += 1;

          expect(command).toBe('vercel');
          expect(args).toEqual(['deploy', '--yes', '--prod', '--token', 'test_token']);

          const copiedArtifactPath = join(options.cwd, 'public', 'simulation-results.json');
          const copiedMetadataPath = join(options.cwd, 'public', 'publish-metadata.json');

          expect(existsSync(copiedArtifactPath)).toBe(true);
          expect(existsSync(copiedMetadataPath)).toBe(true);
          expect(existsSync(join(options.cwd, '.next'))).toBe(false);
          expect(existsSync(join(options.cwd, 'node_modules'))).toBe(false);
          expect(existsSync(join(options.cwd, '.gitignore'))).toBe(false);
          expect(existsSync(join(options.cwd, '.vercel', 'stale-project.json'))).toBe(false);
          expect(existsSync(join(options.cwd, '.vercel', 'project.json'))).toBe(true);

          const artifactRaw = readFileSync(artifactPath, 'utf8');
          expect(readFileSync(copiedArtifactPath, 'utf8')).toBe(artifactRaw);

          return {
            exitCode: 0,
            stdout: 'Production: https://seatbelt-upload-filtering.vercel.app',
            stderr: '',
          };
        },
      },
    );

    expect(runResult.code).toBe(0);
    expect(commandInvocationCount).toBe(1);
  });

  it('runs non-interactive vercel deploy for BYO --publish-provider vercel', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-byo-success-'));
    const artifactPath = fixturePath('simulation-results.executed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let commandInvocationCount = 0;

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--publish-provider', 'vercel', '--log', logPath],
      {
        env: {
          VERCEL_TOKEN: 'test_token',
          VERCEL_PROJECT_ID: 'prj_123',
          VERCEL_ORG_ID: 'team_456',
        },
        runCommand: async (command, args, options) => {
          commandInvocationCount += 1;

          expect(command).toBe('vercel');
          expect(args).toEqual(['deploy', '--yes', '--prod', '--token', 'test_token']);
          expect(existsSync(join(options.cwd, 'package.json'))).toBe(true);
          expect(existsSync(join(options.cwd, 'src', 'app', 'page.tsx'))).toBe(true);
          expect(existsSync(join(options.cwd, 'public', 'simulation-results.json'))).toBe(true);
          expect(existsSync(join(options.cwd, 'public', 'publish-metadata.json'))).toBe(true);
          expect(existsSync(join(options.cwd, '.vercel', 'project.json'))).toBe(true);

          const linkedProjectRaw = readFileSync(
            join(options.cwd, '.vercel', 'project.json'),
            'utf8',
          );
          const linkedProject = JSON.parse(linkedProjectRaw);
          if (!isRecord(linkedProject)) {
            throw new Error('Expected .vercel/project.json to be an object');
          }

          expect(readStringField(linkedProject, 'projectId')).toBe('prj_123');
          expect(readStringField(linkedProject, 'orgId')).toBe('team_456');

          return {
            exitCode: 0,
            stdout: 'Production: https://seatbelt-upload-success.vercel.app',
            stderr: '',
          };
        },
      },
    );

    expect(runResult.code).toBe(0);
    expect(commandInvocationCount).toBe(1);

    const joinedLogs = runResult.logs.join('\n');
    expect(joinedLogs).toContain('Vercel deploy succeeded');
    expect(joinedLogs).toContain(
      'https://seatbelt-upload-success.vercel.app/simulation-results.json',
    );

    expect(existsSync(logPath)).toBe(true);
    const parsedLogEntry = readLogEntry(logPath);
    expect(readStringField(parsedLogEntry, 'mode')).toBe('byo-vercel');
  });
});
