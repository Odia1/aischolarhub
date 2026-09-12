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
    regionalContext: {
      enabled: { type: Boolean, default: true },
      countryCode: { type: String, trim: true, maxlength: 2 },
      country: { type: String, trim: true, maxlength: 80 },
      regionCode: { type: String, trim: true, maxlength: 12 },
      region: { type: String, trim: true, maxlength: 100 },
      city: { type: String, trim: true, maxlength: 100 },
      timezone: { type: String, trim: true, maxlength: 80 },
      locale: { type: String, trim: true, maxlength: 35 },
      currency: { type: String, trim: true, maxlength: 12 },
      educationSystem: { type: String, trim: true, maxlength: 100 },
      languages: [{ type: String, trim: true, maxlength: 60 }],
      developmentContext: { type: String, trim: true, maxlength: 40 },
    },
    category: {
      type: String,
      enum: ['SCHOOL', 'HIGHER_EDUCATION', 'MIXED'],
      default: 'HIGHER_EDUCATION',
      required: true,
      index: true,
    },
  },
  { timestamps: true, collection: 'institutions' },
);

institutionSchema.index({ name: 1 }, { unique: true });

export default institutionSchema;
