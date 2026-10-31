import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../src/bootstrap/config.js';

describe('loadConfig', () => {
  it('loads validated values from the environment', () => {
    const config = loadConfig({
      HOST: '127.0.0.1',
      PORT: '4500',
      LOG_LEVEL: 'debug',
      DATABASE_FILE: './data/test.sqlite',
    });

    expect(config).toEqual({
      host: '127.0.0.1',
      port: 4500,
      logLevel: 'debug',
      databaseFile: './data/test.sqlite',
    });
  });

  it('uses safe development defaults', () => {
    expect(loadConfig({})).toEqual({
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      databaseFile: './data/caderno-mini.sqlite',
    });
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow();
  });
});
