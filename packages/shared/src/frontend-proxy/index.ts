/**
 * Request headers the frontend proxy adds when forwarding `/api/*` to the API.
 * Both sides import these names: if they drift, the API rejects every proxied
 * request.
 */
export const FRONTEND_PROXY_SECRET_HEADER = 'x-roller-bay-proxy-secret';
export const FRONTEND_PROXY_CLIENT_IP_HEADER = 'x-roller-bay-client-ip';
