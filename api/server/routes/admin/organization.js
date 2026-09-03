const express = require('express');

const {
  SystemCapabilities,
} = require('@librechat/data-schemas');

const {
  requireJwtAuth,
} = require('~/server/middleware');

const {
  requireCapability,
} = require('~/server/middleware/roles/capabilities');

const {
  requireInstitutionScope,
} = require('@librechat/api');

const {
  tenantStorage,
  runAsSystem,
} = require('@librechat/data-schemas');

const db = require('~/models');

const { createAdminOrganizationHandlers } = require('@librechat/api');

const router = express.Router();

const requireAdminAccess = requireCapability(
  SystemCapabilities.ACCESS_ADMIN,
);

const requireReadOrganization = requireCapability(
  SystemCapabilities.READ_ORGANIZATION,
);

const requireManageOrganization = requireCapability(
  SystemCapabilities.MANAGE_ORGANIZATION,
);

/**
 * Organization routes always identify the target institution explicitly.
 *
 * /api/admin/organization/:tenantId/...
 *
 * Institution administrators may only use their own tenantId.
 * Platform administrators may select any existing institution.
 *
 * The target tenant is established in AsyncLocalStorage only after
 * authorization and institution existence have been verified.
 */
async function establishOrganizationTenant(req, res, next) {
  const tenantId = String(req.params.tenantId || '').trim();

  if (!tenantId) {
    return res.status(400).json({
      error: 'Institution tenantId is required',
      error_code: 'INSTITUTION_REQUIRED',
    });
  }

  try {
    const institution = await runAsSystem(() =>
      db.getInstitutionById(tenantId),
    );

    if (!institution) {
      return res.status(404).json({
        error: 'Institution not found',
        error_code: 'INSTITUTION_NOT_FOUND',
      });
    }

    return tenantStorage.run(
      {
        tenantId,
        userId:
          req.user?.id ??
          req.user?._id?.toString(),
        requestId: req.requestId,
        requestMethod: req.method,
        requestPath: req.originalUrl ?? req.path,
      },
      next,
    );
  } catch (error) {
    return next(error);
  }
}

const handlers = createAdminOrganizationHandlers({
  listDepartments: db.listDepartments,
  getDepartmentById: db.getDepartmentById,
  createDepartment: db.createDepartment,
  updateDepartment: db.updateDepartment,
  deleteDepartment: db.deleteDepartment,

  listCourses: db.listCourses,
  getCourseById: db.getCourseById,
  createCourse: db.createCourse,
  updateCourse: db.updateCourse,
  deleteCourse: db.deleteCourse,

  listGroupsByDepartment: db.listGroupsByDepartment,
  addGroupToDepartment: db.addGroupToDepartment,
  removeGroupFromDepartment: db.removeGroupFromDepartment,

  listGroupsByCourse: db.listGroupsByCourse,
  addGroupToCourse: db.addGroupToCourse,
  removeGroupFromCourse: db.removeGroupFromCourse,

  listInstructorsByCourse: db.listInstructorsByCourse,
  addInstructorToCourse: db.addInstructorToCourse,
  removeInstructorFromCourse: db.removeInstructorFromCourse,
});

/*
 * Every organization request:
 *
 * 1. must be authenticated;
 * 2. must have normal admin access;
 * 3. must have the appropriate organization capability;
 * 4. must satisfy institution scope;
 * 5. must establish the validated target tenant before reaching handlers.
 */
router.use(
  '/:tenantId',
  requireJwtAuth,
  requireAdminAccess,
  requireInstitutionScope,
  establishOrganizationTenant,
);

router.get('/departments', requireReadOrganization, handlers.listDepartments);
router.get(
  '/departments/:departmentId',
  requireReadOrganization,
  handlers.getDepartment,
);
router.post(
  '/departments',
  requireManageOrganization,
  handlers.createDepartment,
);
router.patch(
  '/departments/:departmentId',
  requireManageOrganization,
  handlers.updateDepartment,
);
router.delete(
  '/departments/:departmentId',
  requireManageOrganization,
  handlers.deleteDepartment,
);

router.get('/courses', requireReadOrganization, handlers.listCourses);
router.get(
  '/courses/:courseId',
  requireReadOrganization,
  handlers.getCourse,
);
router.post(
  '/courses',
  requireManageOrganization,
  handlers.createCourse,
);
router.patch(
  '/courses/:courseId',
  requireManageOrganization,
  handlers.updateCourse,
);
router.delete(
  '/courses/:courseId',
  requireManageOrganization,
  handlers.deleteCourse,
);

router.get(
  '/departments/:departmentId/groups',
  requireReadOrganization,
  handlers.listGroupsByDepartment,
);
router.post(
  '/departments/:departmentId/groups/:groupId',
  requireManageOrganization,
  handlers.addGroupToDepartment,
);
router.delete(
  '/departments/:departmentId/groups/:groupId',
  requireManageOrganization,
  handlers.removeGroupFromDepartment,
);

router.get(
  '/courses/:courseId/groups',
  requireReadOrganization,
  handlers.listGroupsByCourse,
);
router.post(
  '/courses/:courseId/groups/:groupId',
  requireManageOrganization,
  handlers.addGroupToCourse,
);
router.delete(
  '/courses/:courseId/groups/:groupId',
  requireManageOrganization,
  handlers.removeGroupFromCourse,
);

router.get(
  '/courses/:courseId/instructors',
  requireReadOrganization,
  handlers.listInstructorsByCourse,
);
router.post(
  '/courses/:courseId/instructors/:userId',
  requireManageOrganization,
  handlers.addInstructorToCourse,
);
router.delete(
  '/courses/:courseId/instructors/:userId',
  requireManageOrganization,
  handlers.removeInstructorFromCourse,
);

module.exports = router;
