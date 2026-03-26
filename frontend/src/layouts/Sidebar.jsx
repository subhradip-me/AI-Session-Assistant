import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Home, Calendar, Bot, Settings, LogOut, Hexagon } from 'lucide-react';
import { logout } from '../slices/authSlice';
import { disconnectSocket } from '../services/socket';

const NAV_ITEMS = [
  { to: '/',         icon: Home,     label: 'Overview'  },
  { to: '/calendar', icon: Calendar, label: 'Calendar'  },
  { to: '/sessions', icon: Bot,      label: 'Sessions'  },
];

export default function Sidebar() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector((s) => s.auth.user);

  const handleLogout = () => {
    disconnectSocket();
    dispatch(logout());
    navigate('/login');
  };

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const navClass = ({ isActive }) =>
    `relative p-2.5 rounded-xl transition-all duration-150 flex items-center justify-center group
     ${isActive
       ? 'bg-gray-900 text-white shadow-sm'
       : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100/80'}`;

  return (
    <nav
      className="w-[60px] h-full pt-5 pb-4 flex flex-col items-center border-r border-[#ecece9] shrink-0 bg-[#fbfbfa] z-20"
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className="mb-8 text-gray-900" title="AI Session Assistant">
        <Hexagon className="w-7 h-7 fill-current" strokeWidth={0} />
      </div>

      {/* Main Nav */}
      <div className="flex-1 flex flex-col gap-1.5 w-full items-center px-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} className={navClass} title={label} end={to === '/'}>
            {({ isActive }) => (
              <>
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 2} />
                {/* Tooltip */}
                <span className="pointer-events-none absolute left-full ml-3 px-2 py-1 bg-gray-900 text-white text-[11px] font-semibold rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg">
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>

      {/* Bottom Actions */}
      <div className="flex flex-col gap-1.5 w-full items-center px-2 mt-auto">
        <button
          className="p-2.5 rounded-xl text-gray-400 hover:text-gray-900 hover:bg-gray-100/80 transition-all duration-150 group relative flex items-center justify-center"
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="w-5 h-5" />
          <span className="pointer-events-none absolute left-full ml-3 px-2 py-1 bg-gray-900 text-white text-[11px] font-semibold rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
            Settings
          </span>
        </button>

        <button
          onClick={handleLogout}
          className="p-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all duration-150 group relative flex items-center justify-center"
          title="Log out"
          aria-label="Log out"
        >
          <LogOut className="w-5 h-5" />
          <span className="pointer-events-none absolute left-full ml-3 px-2 py-1 bg-gray-900 text-white text-[11px] font-semibold rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
            Log out
          </span>
        </button>

        {/* User Avatar */}
        <div
          className="mt-1 w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-[11px] font-bold cursor-default select-none shrink-0"
          title={user?.name || 'User'}
          aria-label={`Logged in as ${user?.name || 'User'}`}
        >
          {initials}
        </div>
      </div>
    </nav>
  );
}
