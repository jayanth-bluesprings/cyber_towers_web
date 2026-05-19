import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_KEY = import.meta.env.VITE_API_KEY || '';

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 60000,
  headers: API_KEY ? { 'X-API-Key': API_KEY } : {},
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    console.error('API Error:', err.message);
    return Promise.reject(err);
  }
);

export const fetchLive = (params = {}) => api.get('/live', { params });
export const fetchNew = (lastId) => api.get(`/new?lastId=${lastId}`);
export const fetchSearch = (q, params = {}) => api.get('/search', { params: { q, ...params } });
export const fetchAuthorizedVehicles = () => api.get('/authorized-vehicles');
export const fetchVehicleStats = (period = 'day') => api.get(`/vehicle-stats?period=${encodeURIComponent(period)}`);
export const fetchVehicleTypeCount = () => api.get('/vehicle-type-count');
export const fetchVehicleCount = () => api.get('/vehicle-count');
export const fetchVehicleOccupancy = (status = '') =>
  api.get(status ? `/report/occupancy?status=${encodeURIComponent(status)}` : '/report/occupancy');
export const fetchTrigger24hAlert = () => api.get('/alerts/trigger-24h');
export const fetchHealthEvents = () => api.get('/health/events');

const wsBaseUrl = BASE_URL.replace(/^http/, 'ws');
export const WS_URL = API_KEY
  ? `${wsBaseUrl}?apiKey=${encodeURIComponent(API_KEY)}`
  : wsBaseUrl;

export default api;
