/* Swasthya Saarthi — Lightweight Vanilla JS i18n Translation Engine */

const i18n = {
  currentLocale: 'en',
  translations: {},
  fallbackTranslations: {},

  get locale() {
    return this.currentLocale;
  },

  async init(locale) {
    const savedLocale = locale || localStorage.getItem('kioskLocale') || 'en';
    await this.loadFallback();
    await this.setLocale(savedLocale);
  },

  async loadFallback() {
    try {
      const res = await fetch('/i18n/en.json');
      if (res.ok) {
        this.fallbackTranslations = await res.json();
      }
    } catch (err) {
      console.error('Failed to load fallback en.json:', err);
    }
  },

  async setLocale(locale) {
    try {
      const response = await fetch(`/i18n/${locale}.json`);
      if (!response.ok) {
        throw new Error(`Translation file not found: ${locale}`);
      }
      this.translations = await response.json();
      this.currentLocale = locale;
      localStorage.setItem('kioskLocale', locale);
    } catch (error) {
      console.error(`i18n error loading ${locale}:`, error);
      if (locale !== 'en') {
        this.currentLocale = 'en';
        this.translations = this.fallbackTranslations;
      }
    }

    this.updateDOM();
    document.documentElement.lang = this.currentLocale;
  },

  t(key, params = {}) {
    let value = key.split('.').reduce((obj, part) => obj?.[part], this.translations);
    if (!value && this.fallbackTranslations) {
      value = key.split('.').reduce((obj, part) => obj?.[part], this.fallbackTranslations);
    }
    if (!value) return key;

    // Parameter interpolation (e.g. {current})
    Object.keys(params).forEach(param => {
      value = value.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
    });

    return value;
  },

  updateDOM() {
    // Update elements with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (key) {
        el.textContent = this.t(key);
      }
    });

    // Update input placeholders with data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      if (key) {
        el.placeholder = this.t(key);
      }
    });

    // Update accessibility ARIA labels with data-i18n-aria-label
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      const key = el.dataset.i18nAriaLabel;
      if (key) {
        el.setAttribute('aria-label', this.t(key));
      }
    });
  }
};

window.i18n = i18n;

