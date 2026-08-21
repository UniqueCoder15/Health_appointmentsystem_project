/* Shared JavaScript Utilities */

// API base URL
const API_BASE = '/api';

// Token management
const Auth = {
    getToken() {
        return localStorage.getItem('auth_token');
    },

    setToken(token) {
        localStorage.setItem('auth_token', token);
    },

    removeToken() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
    },

    getUser() {
        const user = localStorage.getItem('auth_user');
        return user ? JSON.parse(user) : null;
    },

    setUser(user) {
        localStorage.setItem('auth_user', JSON.stringify(user));
    },

    isAuthenticated() {
        return !!this.getToken();
    },

    isAdmin() {
        const user = this.getUser();
        return user && user.role === 'admin';
    },

    isDoctor() {
        const user = this.getUser();
        return user && user.role === 'doctor';
    },

    isPatient() {
        const user = this.getUser();
        return user && user.role === 'patient';
    },

    logout() {
        this.removeToken();
        window.location.href = '/patient';
    }
};

// API helper functions
const API = {
    async request(endpoint, options = {}) {
        const token = Auth.getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const config = {
            ...options,
            headers
        };

        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, config);
            const data = await response.json();

            if (!response.ok) {
                if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
                    // Express-validator format: { errors: [{ msg: '...', path: '...', ... }] }
                    const messages = data.errors.map(e => e.msg).join('; ');
                    throw new Error(messages);
                }
                throw new Error(data.error || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error(`API Error (${endpoint}):`, error);
            throw error;
        }
    },

    // Auth
    login(email, password) {
        return this.request('/auth/login', {
            method: 'POST',
            body: { email, password }
        });
    },

    register(userData) {
        return this.request('/auth/register', {
            method: 'POST',
            body: userData
        });
    },

    getProfile() {
        return this.request('/auth/me');
    },

    updateProfile(data) {
        return this.request('/api/auth/profile', {
            method: 'PUT',
            body: data
        });
    },

    // Doctors
    getDoctors(specialtyId = null) {
        const params = specialtyId ? `?specialty_id=${specialtyId}` : '';
        return this.request(`/doctors${params}`);
    },

    getDoctor(id) {
        return this.request(`/doctors/${id}`);
    },

    getSpecialties() {
        return this.request('/specialties');
    },

    // Appointments
    getMyAppointments() {
        return this.request('/appointments/my');
    },

    getAppointment(id) {
        return this.request(`/appointments/${id}`);
    },

    createAppointment(data) {
        return this.request('/appointments', {
            method: 'POST',
            body: data
        });
    },

    cancelAppointment(id) {
        return this.request(`/appointments/${id}`, {
            method: 'DELETE'
        });
    },

    // Admin
    getAdminStats() {
        return this.request('/admin/stats');
    },

    getAdminAppointments(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/admin/appointments${query ? `?${query}` : ''}`);
    }
};

// UI Helpers
const UI = {
    showAlert(containerId, message, type = 'error') {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `
            <div class="alert alert-${type}">
                ${message}
            </div>
        `;
    },

    clearAlert(containerId) {
        const container = document.getElementById(containerId);
        if (container) container.innerHTML = '';
    },

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    },

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
    },

    setLoading(button, loading) {
        if (loading) {
            button.disabled = true;
            button.dataset.originalText = button.innerHTML;
            button.innerHTML = '<span class="spinner"></span> Loading...';
        } else {
            button.disabled = false;
            button.innerHTML = button.dataset.originalText || button.innerHTML;
        }
    },

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    formatTime(timeString) {
        const [hours, minutes] = timeString.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes} ${ampm}`;
    },

    getStatusBadge(status) {
        const badges = {
            scheduled: 'badge-primary',
            completed: 'badge-success',
            cancelled: 'badge-danger',
            'no-show': 'badge-warning'
        };
        return `<span class="badge ${badges[status] || 'badge-secondary'}">${status.replace('-', ' ')}</span>`;
    },

    getSpecialtyName(specialtyId) {
        // This would need a lookup, but we'll pass it from the API
        return '';
    }
};

// Form validation
const Validation = {
    validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    },

    validatePhone(phone) {
        const re = /^[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{4,6}$/;
        return re.test(phone);
    },

    validatePassword(password) {
        return password.length >= 6;
    },

    validateRequired(value) {
        return value && value.trim().length > 0;
    },

    showError(input, message) {
        input.classList.add('is-invalid');
        input.classList.remove('is-valid');
        let feedback = input.parentElement.querySelector('.invalid-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.className = 'invalid-feedback';
            input.parentElement.appendChild(feedback);
        }
        feedback.textContent = message;
    },

    showSuccess(input) {
        input.classList.remove('is-invalid');
        input.classList.add('is-valid');
    },

    clearValidation(input) {
        input.classList.remove('is-invalid', 'is-valid');
        const feedback = input.parentElement.querySelector('.invalid-feedback');
        if (feedback) feedback.remove();
    }
};

// Date utilities
const DateUtils = {
    getToday() {
        return new Date().toISOString().split('T')[0];
    },

    getTomorrow() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    },

    addDays(dateString, days) {
        const date = new Date(dateString);
        date.setDate(date.getDate() + days);
        return date.toISOString().split('T')[0];
    }
};

// Export for use in other modules
window.Auth = Auth;
window.API = API;
window.UI = UI;
window.Validation = Validation;
window.DateUtils = DateUtils;