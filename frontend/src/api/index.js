import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 10000,
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    console.error('API Error:', err.message);
    return Promise.reject(err);
  }
);

export const fetchLive = () => api.get('/live');
export const fetchNew = (lastId) => api.get(`/new?lastId=${lastId}`);
export const fetchSearch = (q) => api.get(`/search?q=${encodeURIComponent(q)}`);
export const fetchAuthorizedVehicles = () => api.get('/authorized-vehicles');
export const fetchVehicleStats = (period = 'day') => api.get(`/vehicle-stats?period=${encodeURIComponent(period)}`);
export const fetchVehicleTypeCount = () => api.get('/vehicle-type-count');
export const fetchVehicleCount = () => api.get('/vehicle-count');
export const fetchVehicleOccupancy = (status = '') =>
  api.get(status ? `/report/occupancy?status=${encodeURIComponent(status)}` : '/report/occupancy');

export const WS_URL = BASE_URL.replace(/^http/, 'ws');

export default api;
