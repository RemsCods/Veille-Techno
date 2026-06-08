import { BrowserRouter, Routes, Route, Link, NavLink } from "react-router-dom";
import Feed from "./pages/Feed";
import ArticleDetail from "./pages/ArticleDetail";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <BrowserRouter>
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link to="/" className="text-xl font-bold text-indigo-400 hover:text-indigo-300">
          Veille AI/LLM
        </Link>
        <nav className="flex gap-4 ml-4">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `text-sm ${isActive ? "text-gray-100" : "text-gray-500 hover:text-gray-300"}`
            }
          >
            Feed
          </NavLink>
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `text-sm ${isActive ? "text-gray-100" : "text-gray-500 hover:text-gray-300"}`
            }
          >
            Admin
          </NavLink>
        </nav>
        <a
          href="/docs"
          target="_blank"
          className="ml-auto text-sm text-gray-400 hover:text-gray-200"
        >
          API docs
        </a>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/articles/:id" element={<ArticleDetail />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
