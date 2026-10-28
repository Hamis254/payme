import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import {
  branchApprovalLimiter,
  branchLookupLimiter,
  branchResendLimiter,
} from '#middleware/rateLimiter.middleware.js';
import {
  approveBranch,
  createBusiness,
  resendBranchApproval,
  listMyBusinesses,
  getMyBusinessById,
  getMyBusinessBranches,
  updateMyBusiness,
} from '#controllers/businesses.controller.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/', branchLookupLimiter, createBusiness);
router.get('/', listMyBusinesses);
router.get('/:id/branches', getMyBusinessBranches);
router.get('/:id', getMyBusinessById);
router.put('/:id', updateMyBusiness);
router.post('/:id/branch-approval', branchApprovalLimiter, approveBranch);
router.post(
  '/:id/branch-approval/resend',
  branchResendLimiter,
  resendBranchApproval
);

export default router;
