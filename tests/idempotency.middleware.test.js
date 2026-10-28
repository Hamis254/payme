jest.mock('#config/database.js', () => ({
  db: { select: jest.fn(), update: jest.fn() },
}));

import { idempotencyMiddleware } from '../src/middleware/idempotency.middleware.js';
import { db } from '#config/database.js';

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

  it('replays an HP payment without running another token charge', async () => {
    const cachedResponse = {
      success: true,
      installment: { id: 55 },
      tokens_remaining: 3,
    };
    db.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              response_status: 201,
              response_body: cachedResponse,
              accessed_count: 0,
            },
          ],
        }),
      }),
    });
    db.update.mockReturnValue({
      set: () => ({ where: () => Promise.resolve() }),
    });

    const middleware = idempotencyMiddleware({ requireIdempotencyKey: true });
    const req = {
      method: 'POST',
      path: '/api/hire-purchase/7/11/payment',
      user: { id: 7 },
      body: { installmentId: 55, amountPaid: 2000 },
      get: jest.fn().mockReturnValue(
        '550e8400-e29b-41d4-a716-446655440000'
      ),
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };
    const chargeToken = jest.fn();
    const next = jest.fn(() => chargeToken());

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.set).toHaveBeenCalledWith('Idempotency-Replay', 'true');
    expect(res.json).toHaveBeenCalledWith(cachedResponse);
    expect(next).not.toHaveBeenCalled();
    expect(chargeToken).not.toHaveBeenCalled();
  });
});
