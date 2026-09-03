import type { ClientSession } from 'mongoose';
import type { Response } from 'express';
import { Types } from 'mongoose';
import type { ServerRequest } from '~/types/http';
import {
  type ICourse,
  type IDepartment,
  type IGroup,
  type IUser,
} from '@librechat/data-schemas';

export type OrganizationDeps = {
  listDepartments: (session?: ClientSession) => Promise<IDepartment[]>;
  getDepartmentById: (
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<IDepartment | null>;
  createDepartment: (
    data: {
      name: string;
      description?: string;
      status?: 'active' | 'inactive';
    },
    session?: ClientSession,
  ) => Promise<IDepartment>;
  updateDepartment: (
    departmentId: string | Types.ObjectId,
    data: {
      name?: string;
      description?: string;
      status?: 'active' | 'inactive';
    },
    session?: ClientSession,
  ) => Promise<IDepartment | null>;
  deleteDepartment: (
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<IDepartment | null>;

  listCourses: (
    departmentId?: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<ICourse[]>;
  getCourseById: (
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<ICourse | null>;
  createCourse: (
    data: {
      departmentId: string | Types.ObjectId;
      code: string;
      name: string;
      description?: string;
      status?: 'active' | 'inactive';
    },
    session?: ClientSession,
  ) => Promise<ICourse>;
  updateCourse: (
    courseId: string | Types.ObjectId,
    data: {
      departmentId?: string | Types.ObjectId;
      code?: string;
      name?: string;
      description?: string;
      status?: 'active' | 'inactive';
    },
    session?: ClientSession,
  ) => Promise<ICourse | null>;
  deleteCourse: (
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<ICourse | null>;

  listGroupsByDepartment: (
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<IGroup[]>;
  listDepartmentsByGroup: (
    groupId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<IDepartment[]>;
  addGroupToDepartment: (
    groupId: string | Types.ObjectId,
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<unknown>;
  removeGroupFromDepartment: (
    groupId: string | Types.ObjectId,
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<boolean>;

  listGroupsByCourse: (
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<IGroup[]>;
  listCoursesByGroup: (
    groupId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<ICourse[]>;
  addGroupToCourse: (
    groupId: string | Types.ObjectId,
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<unknown>;
  removeGroupFromCourse: (
    groupId: string | Types.ObjectId,
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<boolean>;

  listInstructorsByCourse: (
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<IUser[]>;
  listCoursesByInstructor: (
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<ICourse[]>;
  addInstructorToCourse: (
    courseId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<unknown>;
  removeInstructorFromCourse: (
    courseId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<boolean>;
};

const isValidObjectId = (value: unknown): value is string | Types.ObjectId =>
  value instanceof Types.ObjectId ||
  (typeof value === 'string' && Types.ObjectId.isValid(value));

const objectIdParam = (req: ServerRequest, name: string): string | null => {
  const value = (req.params as Record<string, unknown>)[name];

  if (!isValidObjectId(value)) {
    return null;
  }

  return String(value);
};

const bodyString = (
  req: ServerRequest,
  name: string,
): string | undefined => {
  const value = (req.body as Record<string, unknown> | undefined)?.[name];

  return typeof value === 'string' ? value.trim() : undefined;
};

const bodyStatus = (
  req: ServerRequest,
): 'active' | 'inactive' | undefined => {
  const value = bodyString(req, 'status');

  if (value === undefined) {
    return undefined;
  }

  return value === 'active' || value === 'inactive' ? value : undefined;
};

const sendInvalid = (
  res: Response,
  message: string,
): Response =>
  res.status(400).json({
    error: message,
    error_code: 'INVALID_ORGANIZATION_REQUEST',
  });

const sendNotFound = (
  res: Response,
  resource: string,
): Response =>
  res.status(404).json({
    error: `${resource} not found`,
    error_code: 'ORGANIZATION_RESOURCE_NOT_FOUND',
  });

const sendServerError = (
  res: Response,
  error: unknown,
): Response => {
  const message =
    error instanceof Error ? error.message : 'Organization operation failed';

  return res.status(500).json({
    error: message,
    error_code: 'ORGANIZATION_OPERATION_FAILED',
  });
};

export function createOrganizationHandlers(deps: OrganizationDeps) {
  return {
    listDepartments: async (_req: ServerRequest, res: Response) => {
      try {
        const departments = await deps.listDepartments();
        return res.status(200).json({ departments });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    getDepartment: async (req: ServerRequest, res: Response) => {
      const departmentId = objectIdParam(req, 'departmentId');

      if (!departmentId) {
        return sendInvalid(res, 'Valid departmentId is required');
      }

      try {
        const department = await deps.getDepartmentById(departmentId);

        if (!department) {
          return sendNotFound(res, 'Department');
        }

        return res.status(200).json({ department });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    createDepartment: async (req: ServerRequest, res: Response) => {
      const name = bodyString(req, 'name');

      if (!name) {
        return sendInvalid(res, 'Department name is required');
      }

      const statusValue = bodyString(req, 'status');

      if (
        statusValue !== undefined &&
        statusValue !== 'active' &&
        statusValue !== 'inactive'
      ) {
        return sendInvalid(res, 'Department status must be active or inactive');
      }

      try {
        const department = await deps.createDepartment({
          name,
          ...(bodyString(req, 'description') !== undefined
            ? { description: bodyString(req, 'description') }
            : {}),
          ...(statusValue !== undefined
            ? { status: statusValue }
            : {}),
        });

        return res.status(201).json({ department });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    updateDepartment: async (req: ServerRequest, res: Response) => {
      const departmentId = objectIdParam(req, 'departmentId');

      if (!departmentId) {
        return sendInvalid(res, 'Valid departmentId is required');
      }

      const name = bodyString(req, 'name');
      const description = bodyString(req, 'description');
      const statusValue = bodyString(req, 'status');

      if (
        statusValue !== undefined &&
        statusValue !== 'active' &&
        statusValue !== 'inactive'
      ) {
        return sendInvalid(res, 'Department status must be active or inactive');
      }

      if (
        name === undefined &&
        description === undefined &&
        statusValue === undefined
      ) {
        return sendInvalid(res, 'At least one department field is required');
      }

      try {
        const department = await deps.updateDepartment(departmentId, {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(statusValue !== undefined ? { status: statusValue } : {}),
        });

        if (!department) {
          return sendNotFound(res, 'Department');
        }

        return res.status(200).json({ department });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    deleteDepartment: async (req: ServerRequest, res: Response) => {
      const departmentId = objectIdParam(req, 'departmentId');

      if (!departmentId) {
        return sendInvalid(res, 'Valid departmentId is required');
      }

      try {
        const department = await deps.deleteDepartment(departmentId);

        if (!department) {
          return sendNotFound(res, 'Department');
        }

        return res.status(200).json({ department });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    listCourses: async (req: ServerRequest, res: Response) => {
      const departmentId = (req.query as Record<string, unknown>)?.departmentId;

      if (
        departmentId !== undefined &&
        !isValidObjectId(departmentId)
      ) {
        return sendInvalid(res, 'Valid departmentId is required');
      }

      try {
        const courses = await deps.listCourses(
          departmentId === undefined ? undefined : String(departmentId),
        );

        return res.status(200).json({ courses });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    getCourse: async (req: ServerRequest, res: Response) => {
      const courseId = objectIdParam(req, 'courseId');

      if (!courseId) {
        return sendInvalid(res, 'Valid courseId is required');
      }

      try {
        const course = await deps.getCourseById(courseId);

        if (!course) {
          return sendNotFound(res, 'Course');
        }

        return res.status(200).json({ course });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    createCourse: async (req: ServerRequest, res: Response) => {
      const departmentId = bodyString(req, 'departmentId');
      const code = bodyString(req, 'code');
      const name = bodyString(req, 'name');

      if (!departmentId || !isValidObjectId(departmentId)) {
        return sendInvalid(res, 'Valid departmentId is required');
      }

      if (!code) {
        return sendInvalid(res, 'Course code is required');
      }

      if (!name) {
        return sendInvalid(res, 'Course name is required');
      }

      const statusValue = bodyString(req, 'status');

      if (
        statusValue !== undefined &&
        statusValue !== 'active' &&
        statusValue !== 'inactive'
      ) {
        return sendInvalid(res, 'Course status must be active or inactive');
      }

      try {
        const course = await deps.createCourse({
          departmentId,
          code,
          name,
          ...(bodyString(req, 'description') !== undefined
            ? { description: bodyString(req, 'description') }
            : {}),
          ...(statusValue !== undefined
            ? { status: statusValue }
            : {}),
        });

        return res.status(201).json({ course });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    updateCourse: async (req: ServerRequest, res: Response) => {
      const courseId = objectIdParam(req, 'courseId');

      if (!courseId) {
        return sendInvalid(res, 'Valid courseId is required');
      }

      const departmentId = bodyString(req, 'departmentId');
      const code = bodyString(req, 'code');
      const name = bodyString(req, 'name');
      const description = bodyString(req, 'description');
      const statusValue = bodyString(req, 'status');

      if (departmentId !== undefined && !isValidObjectId(departmentId)) {
        return sendInvalid(res, 'Valid departmentId is required');
      }

      if (
        statusValue !== undefined &&
        statusValue !== 'active' &&
        statusValue !== 'inactive'
      ) {
        return sendInvalid(res, 'Course status must be active or inactive');
      }

      if (
        departmentId === undefined &&
        code === undefined &&
        name === undefined &&
        description === undefined &&
        statusValue === undefined
      ) {
        return sendInvalid(res, 'At least one course field is required');
      }

      try {
        const course = await deps.updateCourse(courseId, {
          ...(departmentId !== undefined ? { departmentId } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(statusValue !== undefined ? { status: statusValue } : {}),
        });

        if (!course) {
          return sendNotFound(res, 'Course');
        }

        return res.status(200).json({ course });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    deleteCourse: async (req: ServerRequest, res: Response) => {
      const courseId = objectIdParam(req, 'courseId');

      if (!courseId) {
        return sendInvalid(res, 'Valid courseId is required');
      }

      try {
        const course = await deps.deleteCourse(courseId);

        if (!course) {
          return sendNotFound(res, 'Course');
        }

        return res.status(200).json({ course });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    listGroupsByDepartment: async (req: ServerRequest, res: Response) => {
      const departmentId = objectIdParam(req, 'departmentId');

      if (!departmentId) {
        return sendInvalid(res, 'Valid departmentId is required');
      }

      try {
        const groups = await deps.listGroupsByDepartment(departmentId);
        return res.status(200).json({ groups });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    listDepartmentsByGroup: async (req: ServerRequest, res: Response) => {
      const groupId = objectIdParam(req, 'groupId');

      if (!groupId) {
        return sendInvalid(res, 'Valid groupId is required');
      }

      try {
        const departments = await deps.listDepartmentsByGroup(groupId);
        return res.status(200).json({ departments });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    addGroupToDepartment: async (req: ServerRequest, res: Response) => {
      const groupId = objectIdParam(req, 'groupId');
      const departmentId = objectIdParam(req, 'departmentId');

      if (!groupId || !departmentId) {
        return sendInvalid(
          res,
          'Valid groupId and departmentId are required',
        );
      }

      try {
        const relationship = await deps.addGroupToDepartment(
          groupId,
          departmentId,
        );

        return res.status(201).json({ relationship });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    removeGroupFromDepartment: async (
      req: ServerRequest,
      res: Response,
    ) => {
      const groupId = objectIdParam(req, 'groupId');
      const departmentId = objectIdParam(req, 'departmentId');

      if (!groupId || !departmentId) {
        return sendInvalid(
          res,
          'Valid groupId and departmentId are required',
        );
      }

      try {
        const removed = await deps.removeGroupFromDepartment(
          groupId,
          departmentId,
        );

        return res.status(200).json({ removed });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    listGroupsByCourse: async (req: ServerRequest, res: Response) => {
      const courseId = objectIdParam(req, 'courseId');

      if (!courseId) {
        return sendInvalid(res, 'Valid courseId is required');
      }

      try {
        const groups = await deps.listGroupsByCourse(courseId);
        return res.status(200).json({ groups });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    listCoursesByGroup: async (req: ServerRequest, res: Response) => {
      const groupId = objectIdParam(req, 'groupId');

      if (!groupId) {
        return sendInvalid(res, 'Valid groupId is required');
      }

      try {
        const courses = await deps.listCoursesByGroup(groupId);
        return res.status(200).json({ courses });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    addGroupToCourse: async (req: ServerRequest, res: Response) => {
      const groupId = objectIdParam(req, 'groupId');
      const courseId = objectIdParam(req, 'courseId');

      if (!groupId || !courseId) {
        return sendInvalid(res, 'Valid groupId and courseId are required');
      }

      try {
        const relationship = await deps.addGroupToCourse(groupId, courseId);
        return res.status(201).json({ relationship });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    removeGroupFromCourse: async (req: ServerRequest, res: Response) => {
      const groupId = objectIdParam(req, 'groupId');
      const courseId = objectIdParam(req, 'courseId');

      if (!groupId || !courseId) {
        return sendInvalid(res, 'Valid groupId and courseId are required');
      }

      try {
        const removed = await deps.removeGroupFromCourse(
          groupId,
          courseId,
        );

        return res.status(200).json({ removed });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    listInstructorsByCourse: async (req: ServerRequest, res: Response) => {
      const courseId = objectIdParam(req, 'courseId');

      if (!courseId) {
        return sendInvalid(res, 'Valid courseId is required');
      }

      try {
        const instructors = await deps.listInstructorsByCourse(courseId);
        return res.status(200).json({ instructors });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    listCoursesByInstructor: async (req: ServerRequest, res: Response) => {
      const userId = objectIdParam(req, 'userId');

      if (!userId) {
        return sendInvalid(res, 'Valid userId is required');
      }

      try {
        const courses = await deps.listCoursesByInstructor(userId);
        return res.status(200).json({ courses });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    addInstructorToCourse: async (req: ServerRequest, res: Response) => {
      const courseId = objectIdParam(req, 'courseId');
      const userId = objectIdParam(req, 'userId');

      if (!courseId || !userId) {
        return sendInvalid(res, 'Valid courseId and userId are required');
      }

      try {
        const relationship = await deps.addInstructorToCourse(
          courseId,
          userId,
        );

        return res.status(201).json({ relationship });
      } catch (error) {
        return sendServerError(res, error);
      }
    },

    removeInstructorFromCourse: async (
      req: ServerRequest,
      res: Response,
    ) => {
      const courseId = objectIdParam(req, 'courseId');
      const userId = objectIdParam(req, 'userId');

      if (!courseId || !userId) {
        return sendInvalid(res, 'Valid courseId and userId are required');
      }

      try {
        const removed = await deps.removeInstructorFromCourse(
          courseId,
          userId,
        );

        return res.status(200).json({ removed });
      } catch (error) {
        return sendServerError(res, error);
      }
    },
  };
}
