import { apiBaseUrl } from '../lib/config';
import { createAuthSession } from '../stores/auth';
import { createRefreshVault } from './secure-vault';
import { createAuthTransport } from './auth';
import { createApiClient } from './api';
export const authTransport = createAuthTransport(apiBaseUrl);
export const authSession = createAuthSession(authTransport, createRefreshVault());
export const api = createApiClient(apiBaseUrl, authSession);
