import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AboutPage } from './pages/AboutPage';
import { ActivityPage } from './pages/ActivityPage';
import { AdminHome } from './pages/admin/AdminHome';
import { TopicEditor } from './pages/admin/TopicEditor';
import { HomePage } from './pages/HomePage';
import { MapPage } from './pages/MapPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { TopicPage } from './pages/TopicPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="t/:id" element={<TopicPage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="admin" element={<AdminHome />} />
        <Route path="admin/new" element={<TopicEditor />} />
        <Route path="admin/t/:id" element={<TopicEditor />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
