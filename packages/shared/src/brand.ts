/**
 * Product identity. Forks that rebrand change these values (and the matching
 * literals in installer/hive.nsi, which NSIS cannot import).
 *
 * The internal identifiers below (service name, LaunchAgent label, data
 * directory) keep the original "hive" spelling so existing installs keep
 * their data and upgrade in place.
 */
export const PRODUCT_NAME = 'SI Hive';

/** Long form, used on the landing page, installer and page titles. */
export const PRODUCT_FULL_NAME = 'Superintelligence Hive';

export const PRODUCT_URL = 'https://superintelligencehive.com';

/** Default HTTP port for an installed instance. Dev servers use HIVE_PORT. */
export const DEFAULT_PORT = 4747;

/** macOS LaunchAgent label / Windows service name. */
export const LAUNCH_AGENT_LABEL = 'dev.hive.server';
export const WINDOWS_SERVICE_NAME = 'Hive';

/** Per-user data directory name under the home directory (~/.hive). */
export const DATA_DIR_NAME = '.hive';
