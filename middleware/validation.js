const { body, param, query, validationResult } = require('express-validator');

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

// Auth validation
const validateRegister = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('full_name').trim().isLength({ min: 2 }).withMessage('Full name required'),
  body('phone').optional({ checkFalsy: true }).matches(/^[\d\+\-\s\(\)]{7,20}$/).withMessage('Valid phone number required'),
  body('role').optional().isIn(['patient', 'doctor']).withMessage('Invalid role'),
  handleValidationErrors
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
  handleValidationErrors
];

// Appointment validation
const validateCreateAppointment = [
  body('doctor_id').isInt({ min: 1 }).withMessage('Valid doctor ID required'),
  body('appointment_date').isISO8601().withMessage('Valid date required (YYYY-MM-DD)'),
  body('appointment_time').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time required (HH:MM)'),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes too long'),
  handleValidationErrors
];

const validateUpdateAppointment = [
  param('id').isInt({ min: 1 }).withMessage('Valid appointment ID required'),
  body('status').optional().isIn(['scheduled', 'completed', 'cancelled', 'no-show']).withMessage('Invalid status'),
  body('doctor_id').optional().isInt({ min: 1 }).withMessage('Valid doctor ID required'),
  body('appointment_date').optional().isISO8601().withMessage('Valid date required (YYYY-MM-DD)'),
  body('appointment_time').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time required (HH:MM)'),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes too long'),
  handleValidationErrors
];

// Doctor validation
const validateCreateDoctor = [
  body('user_id').isInt({ min: 1 }).withMessage('Valid user ID required'),
  body('specialty_id').isInt({ min: 1 }).withMessage('Valid specialty ID required'),
  body('license_number').trim().isLength({ min: 3 }).withMessage('License number required'),
  body('bio').optional().trim().isLength({ max: 2000 }).withMessage('Bio too long'),
  body('consultation_fee').optional().isFloat({ min: 0 }).withMessage('Valid fee required'),
  body('available_days').optional().isArray().withMessage('Available days must be an array'),
  body('available_hours_start').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid start time required (HH:MM)'),
  body('available_hours_end').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid end time required (HH:MM)'),
  handleValidationErrors
];

const validateUpdateDoctor = [
  param('id').isInt({ min: 1 }).withMessage('Valid doctor ID required'),
  body('specialty_id').optional().isInt({ min: 1 }).withMessage('Valid specialty ID required'),
  body('license_number').optional().trim().isLength({ min: 3 }).withMessage('License number required'),
  body('bio').optional().trim().isLength({ max: 2000 }).withMessage('Bio too long'),
  body('consultation_fee').optional().isFloat({ min: 0 }).withMessage('Valid fee required'),
  body('available_days').optional().isArray().withMessage('Available days must be an array'),
  body('available_hours_start').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid start time required (HH:MM)'),
  body('available_hours_end').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid end time required (HH:MM)'),
  handleValidationErrors
];

// Specialty validation
const validateCreateSpecialty = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Specialty name required (2-100 chars)'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description too long'),
  handleValidationErrors
];

const validateUpdateSpecialty = [
  param('id').isInt({ min: 1 }).withMessage('Valid specialty ID required'),
  body('name').optional().trim().isLength({ min: 2, max: 100 }).withMessage('Specialty name required (2-100 chars)'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description too long'),
  handleValidationErrors
];

// Query validation
const validateAppointmentQuery = [
  query('date_from').optional().isISO8601().withMessage('Valid start date required (YYYY-MM-DD)'),
  query('date_to').optional().isISO8601().withMessage('Valid end date required (YYYY-MM-DD)'),
  query('status').optional().isIn(['scheduled', 'completed', 'cancelled', 'no-show']).withMessage('Invalid status'),
  handleValidationErrors
];

const validateIdParam = [
  param('id').isInt({ min: 1 }).withMessage('Valid ID required'),
  handleValidationErrors
];

module.exports = {
  validateRegister,
  validateLogin,
  validateCreateAppointment,
  validateUpdateAppointment,
  validateCreateDoctor,
  validateUpdateDoctor,
  validateCreateSpecialty,
  validateUpdateSpecialty,
  validateAppointmentQuery,
  validateIdParam,
  handleValidationErrors
};