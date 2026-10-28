jest.mock('#config/database.js', () => ({
  db: {
    insert: jest.fn(),
    delete: jest.fn(),
  },
}));

import { db } from '#config/database.js';
import { deviceTokens } from '#models/deviceToken.model.js';
import {
  deleteDeviceToken,
  registerDeviceToken,
} from '../src/controllers/notification.controller.js';

beforeEach(() => jest.clearAllMocks());

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('notification device-token endpoints', () => {
  it('upserts the authenticated user device token', async () => {
    const onConflictDoUpdate = jest.fn().mockResolvedValue([]);
    db.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({ onConflictDoUpdate }),
    });
    const req = {
      user: { id: 17 },
      body: { token: 'fcm-token', platform: 'android' },
    };
    const res = makeResponse();

    await registerDeviceToken(req, res);

    expect(db.insert).toHaveBeenCalledWith(deviceTokens);
    expect(db.insert().values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 17,
        token: 'fcm-token',
        platform: 'android',
        last_seen_at: expect.any(Date),
      })
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: deviceTokens.token,
        set: expect.objectContaining({
          user_id: 17,
          platform: 'android',
          last_seen_at: expect.any(Date),
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('deletes only the authenticated user token', async () => {
    const where = jest.fn().mockResolvedValue([]);
    db.delete.mockReturnValue({ where });
    const req = { user: { id: 17 }, body: { token: 'fcm-token' } };
    const res = makeResponse();

    await deleteDeviceToken(req, res);

    expect(db.delete).toHaveBeenCalledWith(deviceTokens);
    expect(where).toHaveBeenCalledWith(expect.anything());
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
