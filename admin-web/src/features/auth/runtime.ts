import { Session } from './session';
import { authTransport } from '../../lib/api/transport';
import { createApiClient } from '../../lib/api/client';
export const session = new Session(authTransport);
export const api = createApiClient(session);
