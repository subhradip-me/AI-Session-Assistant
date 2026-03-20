import React from 'react';

const AppLayout = ({ children, sessions, selectedSession, onSelectSession, onNewSession, user, onLogout }) => {
  return (
    <div className="flex h-screen bg-[#FBFBFA] text-[#37352F] font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-[#F7F6F3] border-r border-[#EDEDEB] flex flex-col shrink-0">
        <div className="p-4 flex items-center justify-between">
          <h1 className="font-semibold text-sm tracking-tight opacity-70">AI SESSION ASSISTANT</h1>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 space-y-1 py-4">
          <button 
            onClick={onNewSession}
            className={`flex items-center w-full px-3 py-1.5 text-sm rounded-md transition-notion group ${!selectedSession ? 'bg-[#EBEAE4] font-semibold' : 'hover:bg-[#EBEAE4]'}`}
          >
            <span className="mr-2 opacity-60">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-7-7v14"/></svg>
            </span>
            <span>New Session</span>
          </button>

          <div className="mt-8">
            <h2 className="px-3 mb-2 text-[11px] font-bold uppercase tracking-wider text-[#9E9E9B]">Recent</h2>
            {sessions.map((session) => (
              <button 
                key={session.mediaId} 
                onClick={() => onSelectSession(session.mediaId)}
                className={`flex items-center w-full px-3 py-1.5 text-sm rounded-md transition-notion group ${selectedSession === session.mediaId ? 'bg-[#EBEAE4] font-semibold' : 'hover:bg-[#EBEAE4]'}`}
              >
                <span className="mr-2 opacity-60">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </span>
                <span className="truncate flex-1 text-left">{session.title || 'Untitled Session'}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="p-4 border-t border-[#EDEDEB]">
          <div className="group relative">
            <div className="flex items-center space-x-2 px-2 py-1.5 rounded-md hover:bg-[#EBEAE4] transition-notion cursor-pointer">
              <div className="w-6 h-6 rounded bg-blue-500 text-white flex items-center justify-center text-[10px] font-bold uppercase">
                {user?.name?.substring(0, 2) || 'AD'}
              </div>
              <span className="text-sm font-medium truncate flex-1">{user?.name || 'User'}</span>
            </div>
            {/* Simple context menu logic could go here, or just a logout button */}
            <button 
                onClick={onLogout}
                className="mt-2 w-full text-left px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
            >
                Log out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative h-full">
         {children}
      </div>
    </div>
  );
};

export default AppLayout;
