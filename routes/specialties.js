const express = require('express');
const { queries } = require('../database/db');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { validateCreateSpecialty, validateUpdateSpecialty, validateIdParam } = require('../middleware/validation');

const router = express.Router();

// Get all specialties (public)
router.get('/', (req, res) => {
  try {
    const specialties = queries.getAllSpecialties.all();
    res.json({ specialties });
  } catch (error) {
    console.error('Get specialties error:', error);
    res.status(500).json({ error: 'Failed to fetch specialties' });
  }
});

// Get single specialty
router.get('/:id', validateIdParam, (req, res) => {
  try {
    const specialty = queries.getSpecialtyById.get(req.params.id);

    if (!specialty) {
      return res.status(404).json({ error: 'Specialty not found' });
    }

    res.json({ specialty });
  } catch (error) {
    console.error('Get specialty error:', error);
    res.status(500).json({ error: 'Failed to fetch specialty' });
  }
});

// All following routes require authentication
router.use(authenticateToken);

// Create specialty (admin only)
router.post('/', authorizeRoles('admin'), validateCreateSpecialty, (req, res) => {
  try {
    const { name, description, icon } = req.body;

    const result = queries.createSpecialty.run(name, description || null, icon || '🩺');
    const specialty = queries.getSpecialtyById.get(result.lastInsertRowid);

    res.status(201).json({ message: 'Specialty created', specialty });
  } catch (error) {
    console.error('Create specialty error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Specialty name already exists' });
    }
    res.status(500).json({ error: 'Failed to create specialty' });
  }
});

// Update specialty (admin only)
router.put('/:id', authorizeRoles('admin'), validateUpdateSpecialty, (req, res) => {
  try {
    const specialty = queries.getSpecialtyById.get(req.params.id);

    if (!specialty) {
      return res.status(404).json({ error: 'Specialty not found' });
    }

    const { name, description, icon } = req.body;

    queries.updateSpecialty.run(name || specialty.name, description !== undefined ? description : specialty.description, icon || specialty.icon, req.params.id);
    const updatedSpecialty = queries.getSpecialtyById.get(req.params.id);

    res.json({ message: 'Specialty updated', specialty: updatedSpecialty });
  } catch (error) {
    console.error('Update specialty error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Specialty name already exists' });
    }
    res.status(500).json({ error: 'Failed to update specialty' });
  }
});

// Delete specialty (admin only)
router.delete('/:id', authorizeRoles('admin'), validateIdParam, (req, res) => {
  try {
    const specialty = queries.getSpecialtyById.get(req.params.id);

    if (!specialty) {
      return res.status(404).json({ error: 'Specialty not found' });
    }

    // Check if any doctors use this specialty
    const doctors = queries.getDoctorsBySpecialty.all(req.params.id);
    if (doctors.length > 0) {
      return res.status(400).json({ error: 'Cannot delete specialty with associated doctors' });
    }

    queries.deleteSpecialty.run(req.params.id);
    res.json({ message: 'Specialty deleted' });
  } catch (error) {
    console.error('Delete specialty error:', error);
    res.status(500).json({ error: 'Failed to delete specialty' });
  }
});

module.exports = router;