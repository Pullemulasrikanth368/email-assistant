import express from 'express';
import asyncHandler from 'express-async-handler';
import authenticate from '../middlewares/authenticate';
import usersCtrl from '../controllers/users.controller';

const router = express.Router();

router.use(authenticate.isAllowed);

router.get('/',        asyncHandler(usersCtrl.list));
router.post('/',       asyncHandler(usersCtrl.create));
router.put('/:id',    asyncHandler(usersCtrl.update));
router.delete('/:id', asyncHandler(usersCtrl.remove));

export default router;
