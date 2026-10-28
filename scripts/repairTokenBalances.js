// scripts/repairTokenBalances.js
// Checks that every wallet balance equals the sum of its live token lots.
//
//   node scripts/repairTokenBalances.js          report mismatches only (dry run)
//   node scripts/repairTokenBalances.js --apply  also repair them
//
// Lots are the source of truth. A repair sets the balance to the lots total and
// writes a 'repair' ledger row, so the correction is visible in the history.

import 'dotenv/config';
import { pgPool } from '#config/database.js';
import {
  findWalletMismatches,
  repairWalletBalance,
} from '#services/tokenLots.service.js';

const apply = process.argv.includes('--apply');

try {
  const mismatches = await findWalletMismatches();

  if (mismatches.length === 0) {
    console.log('OK: every wallet balance matches its live lots.');
  } else {
    console.log(`${mismatches.length} wallet(s) disagree with their lots:`);
    console.table(mismatches);

    if (apply) {
      for (const { business_id } of mismatches) {
        const result = await repairWalletBalance(business_id);
        console.log(
          `repaired business ${business_id}: ${result.before} -> ${result.after}`
        );
      }
    } else {
      console.log('Dry run. Re-run with --apply to repair.');
    }
  }
} catch (error) {
  console.error('Token balance check failed:', error);
  process.exitCode = 1;
} finally {
  await pgPool.end();
}
