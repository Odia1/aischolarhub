import { Types } from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import type {
  ICourse,
  ICourseInstructor,
  IDepartment,
  IGroupCourse,
  IGroupDepartment,
  IGroup,
  IUser,
} from '~/types';

import type {
  CreateCourseInput,
  CreateDepartmentInput,
  UpdateCourseInput,
  UpdateDepartmentInput,
} from '~/types/organization';

function toObjectId(value: string | Types.ObjectId, field: string): Types.ObjectId {
  if (value instanceof Types.ObjectId) {
    return value;
  }

  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${field}: ${value}`);
  }

  return new Types.ObjectId(value);
}

export function createOrganizationMethods(
  mongoose: typeof import('mongoose'),
): {
  listDepartments: (session?: ClientSession) => Promise<IDepartment[]>;
  getDepartmentById: (
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<IDepartment | null>;
  createDepartment: (
    data: CreateDepartmentInput,
    session?: ClientSession,
  ) => Promise<IDepartment>;
  updateDepartment: (
    departmentId: string | Types.ObjectId,
    data: UpdateDepartmentInput,
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
    data: CreateCourseInput,
    session?: ClientSession,
  ) => Promise<ICourse>;
  updateCourse: (
    courseId: string | Types.ObjectId,
    data: UpdateCourseInput,
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
  ) => Promise<IGroupDepartment>;
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
  ) => Promise<IGroupCourse>;
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
  ) => Promise<ICourseInstructor>;
  removeInstructorFromCourse: (
    courseId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ) => Promise<boolean>;
} {
  const Department = () => mongoose.models.Department as Model<IDepartment>;
  const Course = () => mongoose.models.Course as Model<ICourse>;
  const Group = () => mongoose.models.Group as Model<IGroup>;
  const User = () => mongoose.models.User as Model<IUser>;
  const GroupDepartment = () =>
    mongoose.models.GroupDepartment as Model<IGroupDepartment>;
  const GroupCourse = () =>
    mongoose.models.GroupCourse as Model<IGroupCourse>;
  const CourseInstructor = () =>
    mongoose.models.CourseInstructor as Model<ICourseInstructor>;

  async function getDepartmentById(
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const id = toObjectId(departmentId, 'departmentId');
    const query = Department().findById(id);
    if (session) query.session(session);
    return query.lean<IDepartment>().exec();
  }

  async function getCourseById(
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const id = toObjectId(courseId, 'courseId');
    const query = Course().findById(id);
    if (session) query.session(session);
    return query.lean<ICourse>().exec();
  }

  async function requireDepartment(
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IDepartment> {
    const department = await getDepartmentById(departmentId, session);
    if (!department) {
      throw new Error(`Department not found: ${departmentId}`);
    }
    return department;
  }

  async function requireCourse(
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<ICourse> {
    const course = await getCourseById(courseId, session);
    if (!course) {
      throw new Error(`Course not found: ${courseId}`);
    }
    return course;
  }

  async function requireGroup(
    groupId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IGroup> {
    const id = toObjectId(groupId, 'groupId');
    const query = Group().findById(id);
    if (session) query.session(session);
    const group = await query.lean<IGroup>().exec();
    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }
    return group;
  }

  async function requireUser(
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<IUser> {
    const id = toObjectId(userId, 'userId');
    const query = User().findById(id);
    if (session) query.session(session);
    const user = await query.lean<IUser>().exec();
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    return user;
  }

  async function listDepartments(session?: ClientSession) {
    const query = Department().find({}).sort({ name: 1 });
    if (session) query.session(session);
    return query.lean<IDepartment[]>().exec();
  }

  async function createDepartment(
    data: CreateDepartmentInput,
    session?: ClientSession,
  ) {
    const name = String(data.name ?? '').trim();
    if (!name) {
      throw new Error('Department name is required');
    }

    const options = session ? { session } : {};
    return Department()
      .create(
        [
          {
            name,
            description: data.description?.trim(),
            status: data.status ?? 'active',
          },
        ],
        options,
      )
      .then((items) => items[0]);
  }

  async function updateDepartment(
    departmentId: string | Types.ObjectId,
    data: UpdateDepartmentInput,
    session?: ClientSession,
  ) {
    const id = toObjectId(departmentId, 'departmentId');
    const set: Record<string, unknown> = {};

    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) {
        throw new Error('Department name cannot be empty');
      }
      set.name = name;
    }

    if (data.description !== undefined) {
      set.description = data.description.trim();
    }

    if (data.status !== undefined) {
      set.status = data.status;
    }

    const query = Department().findByIdAndUpdate(
      id,
      { $set: set },
      { new: true, runValidators: true },
    );

    if (session) query.session(session);

    return query.lean<IDepartment>().exec();
  }

  async function deleteDepartment(
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const id = toObjectId(departmentId, 'departmentId');

    const courseQuery = Course().countDocuments({ departmentId: id });
    if (session) courseQuery.session(session);

    const courseCount = await courseQuery.exec();
    if (courseCount > 0) {
      throw new Error(
        `Cannot delete department ${departmentId}: ${courseCount} course(s) still belong to it`,
      );
    }

    const options = session ? { session } : {};
    return Department().findByIdAndDelete(id, options).lean<IDepartment>().exec();
  }

  async function listCourses(
    departmentId?: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const filter: Record<string, unknown> = {};

    if (departmentId !== undefined) {
      filter.departmentId = toObjectId(departmentId, 'departmentId');
    }

    const query = Course().find(filter).sort({ code: 1, name: 1 });
    if (session) query.session(session);

    return query.lean<ICourse[]>().exec();
  }

  async function createCourse(
    data: CreateCourseInput,
    session?: ClientSession,
  ) {
    const departmentId = toObjectId(data.departmentId, 'departmentId');
    await requireDepartment(departmentId, session);

    const code = String(data.code ?? '').trim().toUpperCase();
    const name = String(data.name ?? '').trim();

    if (!code) {
      throw new Error('Course code is required');
    }

    if (!name) {
      throw new Error('Course name is required');
    }

    const options = session ? { session } : {};

    return Course()
      .create(
        [
          {
            departmentId,
            code,
            name,
            description: data.description?.trim(),
            status: data.status ?? 'active',
          },
        ],
        options,
      )
      .then((items) => items[0]);
  }

  async function updateCourse(
    courseId: string | Types.ObjectId,
    data: UpdateCourseInput,
    session?: ClientSession,
  ) {
    const id = toObjectId(courseId, 'courseId');
    const set: Record<string, unknown> = {};

    if (data.departmentId !== undefined) {
      const departmentId = toObjectId(data.departmentId, 'departmentId');
      await requireDepartment(departmentId, session);
      set.departmentId = departmentId;
    }

    if (data.code !== undefined) {
      const code = data.code.trim().toUpperCase();
      if (!code) {
        throw new Error('Course code cannot be empty');
      }
      set.code = code;
    }

    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) {
        throw new Error('Course name cannot be empty');
      }
      set.name = name;
    }

    if (data.description !== undefined) {
      set.description = data.description.trim();
    }

    if (data.status !== undefined) {
      set.status = data.status;
    }

    const query = Course().findByIdAndUpdate(
      id,
      { $set: set },
      { new: true, runValidators: true },
    );

    if (session) query.session(session);

    return query.lean<ICourse>().exec();
  }

  async function deleteCourse(
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const id = toObjectId(courseId, 'courseId');
    const options = session ? { session } : {};

    const course = await Course()
      .findByIdAndDelete(id, options)
      .lean<ICourse>()
      .exec();

    if (!course) {
      return null;
    }

    await GroupCourse().deleteMany({ courseId: id }, options);
    await CourseInstructor().deleteMany({ courseId: id }, options);

    return course;
  }

  async function addGroupToDepartment(
    groupId: string | Types.ObjectId,
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const group = await requireGroup(groupId, session);
    const department = await requireDepartment(departmentId, session);

    const options = session ? { session } : {};

    return GroupDepartment()
      .findOneAndUpdate(
        {
          groupId: group._id,
          departmentId: department._id,
        },
        {
          $setOnInsert: {
            groupId: group._id,
            departmentId: department._id,
          },
        },
        { upsert: true, new: true, runValidators: true, ...options },
      )
      .lean<IGroupDepartment>()
      .exec();
  }

  async function removeGroupFromDepartment(
    groupId: string | Types.ObjectId,
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const group = await requireGroup(groupId, session);
    const department = await requireDepartment(departmentId, session);

    const result = await GroupDepartment().deleteOne(
      {
        groupId: group._id,
        departmentId: department._id,
      },
      session ? { session } : {},
    );

    return result.deletedCount > 0;
  }

  async function listGroupsByDepartment(
    departmentId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const department = await requireDepartment(departmentId, session);

    const relationshipQuery = GroupDepartment().find(
      { departmentId: department._id },
      { groupId: 1 },
    );

    if (session) relationshipQuery.session(session);

    const relationships = await relationshipQuery.lean<
      Array<Pick<IGroupDepartment, 'groupId'>>
    >();

    const groupIds = relationships.map((item) => item.groupId);

    if (!groupIds.length) {
      return [];
    }

    const query = Group().find({ _id: { $in: groupIds } }).sort({ name: 1 });
    if (session) query.session(session);

    return query.lean<IGroup[]>().exec();
  }

  async function listDepartmentsByGroup(
    groupId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const group = await requireGroup(groupId, session);

    const relationshipQuery = GroupDepartment().find(
      { groupId: group._id },
      { departmentId: 1 },
    );

    if (session) relationshipQuery.session(session);

    const relationships = await relationshipQuery.lean<
      Array<Pick<IGroupDepartment, 'departmentId'>>
    >();

    const departmentIds = relationships.map((item) => item.departmentId);

    if (!departmentIds.length) {
      return [];
    }

    const query = Department()
      .find({ _id: { $in: departmentIds } })
      .sort({ name: 1 });

    if (session) query.session(session);

    return query.lean<IDepartment[]>().exec();
  }

  async function addGroupToCourse(
    groupId: string | Types.ObjectId,
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const group = await requireGroup(groupId, session);
    const course = await requireCourse(courseId, session);

    const options = session ? { session } : {};

    return GroupCourse()
      .findOneAndUpdate(
        {
          groupId: group._id,
          courseId: course._id,
        },
        {
          $setOnInsert: {
            groupId: group._id,
            courseId: course._id,
          },
        },
        { upsert: true, new: true, runValidators: true, ...options },
      )
      .lean<IGroupCourse>()
      .exec();
  }

  async function removeGroupFromCourse(
    groupId: string | Types.ObjectId,
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const group = await requireGroup(groupId, session);
    const course = await requireCourse(courseId, session);

    const result = await GroupCourse().deleteOne(
      {
        groupId: group._id,
        courseId: course._id,
      },
      session ? { session } : {},
    );

    return result.deletedCount > 0;
  }

  async function listGroupsByCourse(
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const course = await requireCourse(courseId, session);

    const relationshipQuery = GroupCourse().find(
      { courseId: course._id },
      { groupId: 1 },
    );

    if (session) relationshipQuery.session(session);

    const relationships = await relationshipQuery.lean<
      Array<Pick<IGroupCourse, 'groupId'>>
    >();

    const groupIds = relationships.map((item) => item.groupId);

    if (!groupIds.length) {
      return [];
    }

    const query = Group().find({ _id: { $in: groupIds } }).sort({ name: 1 });
    if (session) query.session(session);

    return query.lean<IGroup[]>().exec();
  }

  async function listCoursesByGroup(
    groupId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const group = await requireGroup(groupId, session);

    const relationshipQuery = GroupCourse().find(
      { groupId: group._id },
      { courseId: 1 },
    );

    if (session) relationshipQuery.session(session);

    const relationships = await relationshipQuery.lean<
      Array<Pick<IGroupCourse, 'courseId'>>
    >();

    const courseIds = relationships.map((item) => item.courseId);

    if (!courseIds.length) {
      return [];
    }

    const query = Course().find({ _id: { $in: courseIds } }).sort({ code: 1 });
    if (session) query.session(session);

    return query.lean<ICourse[]>().exec();
  }

  async function addInstructorToCourse(
    courseId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const course = await requireCourse(courseId, session);
    const user = await requireUser(userId, session);

    if (String(user.role ?? '').toUpperCase() !== 'INSTRUCTOR') {
      throw new Error(`User is not an Instructor: ${userId}`);
    }

    const options = session ? { session } : {};

    return CourseInstructor()
      .findOneAndUpdate(
        {
          courseId: course._id,
          userId: user._id,
        },
        {
          $setOnInsert: {
            courseId: course._id,
            userId: user._id,
          },
        },
        { upsert: true, new: true, runValidators: true, ...options },
      )
      .lean<ICourseInstructor>()
      .exec();
  }

  async function removeInstructorFromCourse(
    courseId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const course = await requireCourse(courseId, session);
    const user = await requireUser(userId, session);

    const result = await CourseInstructor().deleteOne(
      {
        courseId: course._id,
        userId: user._id,
      },
      session ? { session } : {},
    );

    return result.deletedCount > 0;
  }

  async function listInstructorsByCourse(
    courseId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const course = await requireCourse(courseId, session);

    const relationshipQuery = CourseInstructor().find(
      { courseId: course._id },
      { userId: 1 },
    );

    if (session) relationshipQuery.session(session);

    const relationships = await relationshipQuery.lean<
      Array<Pick<ICourseInstructor, 'userId'>>
    >();

    const userIds = relationships.map((item) => item.userId);

    if (!userIds.length) {
      return [];
    }

    const query = User().find({ _id: { $in: userIds } }).sort({ name: 1 });
    if (session) query.session(session);

    return query.lean<IUser[]>().exec();
  }

  async function listCoursesByInstructor(
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ) {
    const user = await requireUser(userId, session);

    const relationshipQuery = CourseInstructor().find(
      { userId: user._id },
      { courseId: 1 },
    );

    if (session) relationshipQuery.session(session);

    const relationships = await relationshipQuery.lean<
      Array<Pick<ICourseInstructor, 'courseId'>>
    >();

    const courseIds = relationships.map((item) => item.courseId);

    if (!courseIds.length) {
      return [];
    }

    const query = Course().find({ _id: { $in: courseIds } }).sort({ code: 1 });
    if (session) query.session(session);

    return query.lean<ICourse[]>().exec();
  }

  return {
    listDepartments,
    getDepartmentById,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    listCourses,
    getCourseById,
    createCourse,
    updateCourse,
    deleteCourse,
    listGroupsByDepartment,
    listDepartmentsByGroup,
    addGroupToDepartment,
    removeGroupFromDepartment,
    listGroupsByCourse,
    listCoursesByGroup,
    addGroupToCourse,
    removeGroupFromCourse,
    listInstructorsByCourse,
    listCoursesByInstructor,
    addInstructorToCourse,
    removeInstructorFromCourse,
  };
}

export type OrganizationMethods = ReturnType<typeof createOrganizationMethods>;
