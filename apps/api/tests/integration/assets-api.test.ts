import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/test-app.js';

describe('assets API', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'] | undefined;
  let database: Awaited<ReturnType<typeof createTestApp>>['database'] | undefined;

  afterEach(async () => {
    await app?.close();
    database?.close();
    app = undefined;
    database = undefined;
  });

  it('stores a validated image and serves it back by the server-generated ID', async () => {
    ({ app, database } = await createTestApp());

    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      payload: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    });
    const body = uploaded.json<{ data: { id: string; contentUrl: string } }>();

    expect(uploaded.statusCode).toBe(201);
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.data.contentUrl).toBe(`/api/v1/assets/${body.data.id}/content`);

    const image = await app.inject({ method: 'GET', url: body.data.contentUrl });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect(image.headers['cache-control']).toContain('immutable');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.rawPayload).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it('rejects invalid image bytes and unknown asset IDs', async () => {
    ({ app, database } = await createTestApp());

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      payload: { dataUrl: 'data:image/png;base64,ZmFrZQ==' },
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/assets/7b7d828b-f189-496a-b59b-9fae6a9b8531/content',
    });

    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe('IMAGE_UPLOAD_INVALID');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('ASSET_NOT_FOUND');
  });
});
