/**
 * Swasthya Saarthi — Medical Records Router Alias
 * Proxies requests to reports.js to provide /api/medical-records endpoints.
 */

const reportsRouter = require('./reports');
module.exports = reportsRouter;
