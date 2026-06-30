import express from 'express';
import asyncHandler from 'express-async-handler';
import authenticate from '../middlewares/authenticate';
import rolesCtrl from '../controllers/roles.controller';

const router = express.Router();

router.use(authenticate.isAllowed);

router.get('/',        asyncHandler(rolesCtrl.list));
router.post('/',       asyncHandler(rolesCtrl.create));
router.put('/:id',    asyncHandler(rolesCtrl.update));
router.delete('/:id', asyncHandler(rolesCtrl.remove));

export default router;
