import { Schema } from 'mongoose';
import type { IInstitution } from '~/types/institution';

const institutionSchema = new Schema<IInstitution>(
  {
    _id: {
      type: String,
      required: true,
      immutable: true,
      match: /^[-a-zA-Z0-9_.]{1,128}$/,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200,
    },
    status: {
      type: String,
      enum: ['enabled', 'disabled'],
      default: 'enabled',
      required: true,
      index: true,
    },
  },
  { timestamps: true, collection: 'institutions' },
);

institutionSchema.index({ name: 1 }, { unique: true });

export default institutionSchema;
