/**
 * In-process stand-in for the drizzle calls the services make.
 *
 * It supports the chains used here: select/insert/update with where, limit,
 * returning and for('update'). It enforces the unique indexes the tests care
 * about, and it rolls a transaction back on error.
 *
 * Locking: FOR UPDATE takes a single lock for the whole fake, which is
 * coarser than Postgres row locks. That is enough to serialize the logic under
 * test. `lockingEnabled: false` turns the lock off, so a test can show that a
 * race is real without it.
 *
 * Test files must mock 'drizzle-orm' (eq and and) and point at this helper.
 */

import { businesses } from '#models/setting.model.js';
import {
  tokenPurchases,
  wallets,
  walletTransactions,
} from '#models/myWallet.model.js';
import { users } from '#models/user.model.js';
import { branchApprovalOtps } from '#models/branchApproval.model.js';
import { tokenLots, tokenLotConsumptions } from '#models/tokenLot.model.js';

const TABLES = new Map([
  [businesses, 'businesses'],
  [wallets, 'wallets'],
  [users, 'users'],
  [tokenPurchases, 'token_purchases'],
  [branchApprovalOtps, 'branch_approval_otps'],
  [walletTransactions, 'wallet_transactions'],
  [tokenLots, 'token_lots'],
  [tokenLotConsumptions, 'token_lot_consumptions'],
]);

// A macrotask yield, so concurrent transactions actually interleave.
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const pgError = constraint => {
  const err = Object.assign(new Error(`duplicate key: ${constraint}`), {
    code: '23505',
    constraint,
  });
  // Drizzle wraps driver errors in `cause`, so the fake does too.
  return Object.assign(new Error('Failed query'), { cause: err });
};

const project = (row, fields) => {
  if (!fields) return { ...row };
  const out = {};
  for (const [key, column] of Object.entries(fields)) {
    out[key] = row[column.name];
  }
  return out;
};

const matches = (row, cond) => {
  if (!cond) return true;
  if (cond.kind === 'eq') return row[cond.col.name] === cond.val;
  if (cond.kind === 'and') return cond.conds.every(c => matches(row, c));
  throw new Error(`unsupported condition ${cond.kind}`);
};

export function buildFake({ lockingEnabled = true } = {}) {
  const store = {
    businesses: [],
    wallets: [],
    token_purchases: [],
    users: [],
    branch_approval_otps: [],
    wallet_transactions: [],
    token_lots: [],
    token_lot_consumptions: [],
  };
  const seq = Object.fromEntries(Object.keys(store).map(name => [name, 0]));

  let txCounter = 0;
  let lockOwner = null;
  const lockQueue = [];

  const acquire = async txId => {
    if (!lockingEnabled || lockOwner === txId) return;
    if (lockOwner === null) {
      lockOwner = txId;
      return;
    }
    await new Promise(resolve => lockQueue.push({ txId, resolve }));
  };

  // Hand the lock straight to the next waiter, so no third transaction can
  // slip in between release and wake-up.
  const release = txId => {
    if (!lockingEnabled || lockOwner !== txId) return;
    const next = lockQueue.shift();
    if (next) {
      lockOwner = next.txId;
      next.resolve();
    } else {
      lockOwner = null;
    }
  };

  const checkUnique = (table, row) => {
    if (table === 'businesses') {
      if (store.businesses.some(o => o.business_code === row.business_code)) {
        throw pgError('businesses_business_code_unique');
      }
      if (row.parent_business_id !== null && row.branch_sequence !== null) {
        const clash = store.businesses.some(
          o =>
            o.parent_business_id === row.parent_business_id &&
            o.branch_sequence === row.branch_sequence
        );
        if (clash) throw pgError('idx_businesses_parent_branch_sequence');
      }
    }
    if (table === 'token_lots' && row.source === 'trial') {
      if (
        store.token_lots.some(
          o => o.business_id === row.business_id && o.source === 'trial'
        )
      ) {
        throw pgError('idx_token_lots_trial_once');
      }
    }
  };

  const withDefaults = (table, values) => {
    const now = new Date();
    const id = ++seq[table];
    const defaults = { id, created_at: now };

    if (table === 'businesses') {
      Object.assign(defaults, {
        verified: false,
        is_main: true,
        parent_business_id: null,
        branch_sequence: null,
        branch_status: 'active',
        location_description: null,
        logo_url: null,
        updated_at: now,
      });
    } else if (table === 'branch_approval_otps') {
      Object.assign(defaults, { attempts: 0, consumed_at: null });
    } else if (table === 'token_lots') {
      Object.assign(defaults, {
        expires_at: null,
        notice_day5_sent_at: null,
        notice_expiry_sent_at: null,
        note: null,
      });
    } else if (table === 'token_lot_consumptions') {
      Object.assign(defaults, { refunded_at: null });
    } else if (table === 'wallet_transactions') {
      Object.assign(defaults, {
        reference: null,
        note: null,
        created_by: null,
      });
    }

    return { ...defaults, ...values };
  };

  function makeTx(txId) {
    const undo = [];

    const selectBuilder = fields => {
      const q = { table: null, cond: null, locking: false, limit: null };
      const builder = {
        from(table) {
          q.table = TABLES.get(table);
          return builder;
        },
        where(cond) {
          q.cond = cond;
          return builder;
        },
        for() {
          q.locking = true;
          return builder;
        },
        limit(n) {
          q.limit = n;
          return builder;
        },
        then(resolve, reject) {
          return (async () => {
            if (q.locking) await acquire(txId);
            await tick();
            let rows = store[q.table].filter(row => matches(row, q.cond));
            if (q.limit !== null) rows = rows.slice(0, q.limit);
            return rows.map(row => project(row, fields));
          })().then(resolve, reject);
        },
      };
      return builder;
    };

    const insertBuilder = (table, values) => {
      const run = async () => {
        await tick();
        const name = TABLES.get(table);
        const row = withDefaults(name, values);
        checkUnique(name, row);
        store[name].push(row);
        undo.push(() => {
          store[name] = store[name].filter(r => r !== row);
        });
        return row;
      };
      return {
        returning(fields) {
          return {
            then(resolve, reject) {
              // Drizzle's returning() always resolves to an array.
              return run()
                .then(row => [project(row, fields)])
                .then(resolve, reject);
            },
          };
        },
        then(resolve, reject) {
          return run().then(resolve, reject);
        },
      };
    };

    const updateBuilder = (table, set) => ({
      where(cond) {
        const run = async () => {
          await tick();
          const name = TABLES.get(table);
          const rows = store[name].filter(row => matches(row, cond));
          for (const row of rows) {
            const before = { ...row };
            undo.push(() => Object.assign(row, before));
            Object.assign(row, set);
          }
          return rows;
        };
        return {
          returning(fields) {
            return {
              then(resolve, reject) {
                return run()
                  .then(rows => rows.map(row => project(row, fields)))
                  .then(resolve, reject);
              },
            };
          },
          then(resolve, reject) {
            return run().then(resolve, reject);
          },
        };
      },
    });

    return {
      select: selectBuilder,
      insert: table => ({ values: values => insertBuilder(table, values) }),
      update: table => ({ set: set => updateBuilder(table, set) }),
      _undo: undo,
    };
  }

  const transaction = async callback => {
    const txId = ++txCounter;
    const tx = makeTx(txId);
    try {
      return await callback(tx);
    } catch (error) {
      for (const revert of tx._undo.reverse()) revert();
      throw error;
    } finally {
      release(txId);
    }
  };

  return {
    store,
    transaction,
    insert: table => ({
      values: values => makeTx(null).insert(table).values(values),
    }),
    select: fields => makeTx(null).select(fields),
    update: table => makeTx(null).update(table),
  };
}

/** Wires a fresh fake into the mocked `db` object a test imports. */
export function installFake(db, options) {
  const fake = buildFake(options);
  db.transaction.mockImplementation(fake.transaction);
  if (!db.insert) db.insert = jest.fn();
  db.insert.mockImplementation(fake.insert);
  db.select.mockImplementation(fake.select);
  db.update.mockImplementation(fake.update);
  return fake;
}
