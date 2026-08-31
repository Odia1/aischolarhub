const express = require('express');
const { createAdminInstitutionsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const handlers = createAdminInstitutionsHandlers({
  listInstitutions: db.listInstitutions,
  countInstitutions: db.countInstitutions,
  getInstitutionById: db.getInstitutionById,
  createInstitution: db.createInstitution,
  updateInstitution: db.updateInstitution,
  deleteInstitution: db.deleteInstitution,
  purgeTenantData: db.purgeTenantData,
  findUser: db.findUser,
  updateUser: db.updateUser,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', handlers.listInstitutions);
router.post('/', handlers.createInstitution);
router.patch('/:id', handlers.updateInstitution);
router.delete('/:id', handlers.deleteInstitution);
router.post('/:id/admin', handlers.assignAdmin);

module.exports = router;
