import { idempotencyMiddleware } from '../src/middleware/idempotency.middleware.js';

describe('idempotency middleware', () => {
  it('rejects mutation requests without an idempotency key when required', async () => {
    const middleware = idempotencyMiddleware({ requireIdempotencyKey: true });

    const req = {
      method: 'POST',
      path: '/api/payme/',
      user: { id: 7 },
      body: { business_id: 1 },
      get: jest.fn().mockReturnValue(null),
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };

    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Missing Idempotency-Key',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
