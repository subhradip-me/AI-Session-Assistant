import React, { useState } from 'react';
import { Calendar as CalendarIcon, Clock, Video, MoreHorizontal, Plus, ChevronLeft, ChevronRight, Bell, X } from 'lucide-react';

export default function CalendarView() {
  const [selectedDate, setSelectedDate] = useState(new Date(2026, 9, 24)); // Oct 24, 2026
  
  const [events, setEvents] = useState([
    { id: 1, title: 'Weekly Sync', date: '2026-10-24', startHour: 10, duration: 1, type: 'Zoom Room', participants: 4 },
    { id: 2, title: 'Design Review', date: '2026-10-24', startHour: 14, duration: 1, type: 'Google Meet', participants: 3 },
    { id: 3, title: 'Client Kickoff', date: '2026-10-25', startHour: 11, duration: 1, type: 'Zoom Room', participants: 5 },
    { id: 4, title: 'Product Roadmap', date: '2026-10-23', startHour: 13, duration: 1, type: 'Google Meet', participants: 6 },
  ]);

  const [notifications, setNotifications] = useState([
    { id: 1, user: 'Sarah', text: 'mentioned you in', link: 'Q3 Roadmap Planning', time: '10m ago', unread: true },
    { id: 2, user: 'John', text: 'uploaded a new recording', link: 'Design Review', time: '1h ago', unread: true },
    { id: 3, user: 'Alex', text: 'completed action item', link: 'Update API docs', time: '2h ago', unread: false },
    { id: 4, user: 'System', text: 'Meeting transcript is ready', link: 'Client Kickoff', time: '1d ago', unread: false },
  ]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [newEventObj, setNewEventObj] = useState({
    title: '',
    date: '',
    startHour: 9,
    duration: 1,
    type: 'Zoom Room',
    link: ''
  });

  const hours = Array.from({ length: 14 }, (_, i) => i + 9); // 9 AM to 10 PM

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };
  
  const formatDateString = (date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const handlePrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  const handleNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSelectedDate(next);
  };

  const currentDateString = formatDateString(selectedDate);
  const todaysEvents = events.filter(e => e.date === currentDateString);

  const handleSchedule = () => {
    setNewEventObj({
      title: '',
      date: currentDateString,
      startHour: 9,
      duration: 1,
      type: 'Zoom Room',
      link: ''
    });
    setEditingEventId(null);
    setIsModalOpen(true);
  };

  const handleEventClick = (event) => {
    setSelectedEvent(event);
    setIsSidePanelOpen(true);
  };

  const handleEdit = (event) => {
    setNewEventObj({
      title: event.title,
      date: event.date,
      startHour: event.startHour,
      duration: event.duration,
      type: event.type,
      link: event.link || ''
    });
    setEditingEventId(event.id);
    setIsModalOpen(true);
  };

  const handleDeleteSession = () => {
    if (selectedEvent) {
      setEvents(events.filter(e => e.id !== selectedEvent.id));
      setIsSidePanelOpen(false);
      setSelectedEvent(null);
    }
  };

  const handleDelete = () => {
    setEvents(events.filter(e => e.id !== editingEventId));
    setIsModalOpen(false);
  };

  const handleSaveEvent = () => {
    if (!newEventObj.title) {
       alert("Please enter a Session Title");
       return;
    }
    
    const start = newEventObj.startHour;
    const end = start + newEventObj.duration;
    
    // Check for overlap on the same date
    const hasOverlap = events.some(e => {
       if (editingEventId === e.id) return false;
       if (e.date !== newEventObj.date) return false;
       const eStart = e.startHour;
       const eEnd = eStart + e.duration;
       // overlap logic: true if start is before the event ends AND end is after the event starts
       return start < eEnd && end > eStart;
    });

    if (hasOverlap) {
       alert("This time slot overlaps with an existing session on the calendar.");
       return;
    }

    if (editingEventId) {
       setEvents(events.map(e => e.id === editingEventId ? { ...e, ...newEventObj } : e));
    } else {
       const newEvent = {
          id: Date.now(),
          ...newEventObj,
          participants: 1
       };
       setEvents([...events, newEvent]);
    }
    setIsModalOpen(false);
  };

  const getPlatformColors = (type) => {
    switch (type) {
      case 'Zoom Room':
        return { bg: 'bg-blue-50/95', border: 'border-blue-200 hover:border-blue-300', title: 'text-blue-900', time: 'text-blue-700 bg-white/60', text: 'text-blue-700', btn: 'text-blue-700 bg-white/80 hover:bg-white border-blue-100' };
      case 'Google Meet':
        return { bg: 'bg-emerald-50/95', border: 'border-emerald-200 hover:border-emerald-300', title: 'text-emerald-900', time: 'text-emerald-700 bg-white/60', text: 'text-emerald-700', btn: 'text-emerald-700 bg-white/80 hover:bg-white border-emerald-100' };
      case 'Microsoft Teams':
        return { bg: 'bg-indigo-50/95', border: 'border-indigo-200 hover:border-indigo-300', title: 'text-indigo-900', time: 'text-indigo-700 bg-white/60', text: 'text-indigo-700', btn: 'text-indigo-700 bg-white/80 hover:bg-white border-indigo-100' };
      case 'In Person':
        return { bg: 'bg-amber-50/95', border: 'border-amber-200 hover:border-amber-300', title: 'text-amber-900', time: 'text-amber-800 bg-white/60', text: 'text-amber-800', btn: 'text-amber-800 bg-white/80 hover:bg-white border-amber-100' };
      case 'Phone Call':
        return { bg: 'bg-rose-50/95', border: 'border-rose-200 hover:border-rose-300', title: 'text-rose-900', time: 'text-rose-700 bg-white/60', text: 'text-rose-700', btn: 'text-rose-700 bg-white/80 hover:bg-white border-rose-100' };
      default:
        return { bg: 'bg-gray-50/95', border: 'border-gray-200 hover:border-gray-300', title: 'text-gray-900', time: 'text-gray-600 bg-white/60', text: 'text-gray-700', btn: 'text-gray-700 bg-white/80 hover:bg-white border-gray-100' };
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white relative">
      
      {/* Top Header */}
      <div className="h-14 border-b border-[#ecece9] flex items-center justify-between px-6 shrink-0 bg-white z-10 w-full">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-gray-400" />
          <h2 className="text-[14px] font-medium text-gray-800">Calendar</h2>
        </div>
        <div className="flex items-center gap-2">
          <button 
             onClick={handleSchedule}
             className="flex items-center gap-1.5 bg-white border border-[#ecece9] text-gray-800 text-[13px] font-medium px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-all shadow-[0_2px_4px_rgba(0,0,0,0.02)] active:scale-[0.98]">
             <Plus className="w-3.5 h-3.5" /> Schedule
          </button>
          <button className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-md transition-colors"><MoreHorizontal className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        
        {/* Main Calendar Area */}
        <div className="flex-1 flex flex-col items-center px-6 pt-6 pb-6 overflow-hidden w-full">
           
           {/* Date Navigation */}
           <div className="w-full max-w-3xl flex items-center justify-between mb-6 shrink-0">
             <div className="flex items-center gap-2">
               <button onClick={handlePrevDay} className="p-1.5 border border-[#ecece9] rounded-md text-gray-500 hover:bg-gray-50 hover:text-gray-800 shadow-[0_2px_4px_rgba(0,0,0,0.02)] transition-colors">
                 <ChevronLeft className="w-4 h-4" />
               </button>
               <button onClick={handleNextDay} className="p-1.5 border border-[#ecece9] rounded-md text-gray-500 hover:bg-gray-50 hover:text-gray-800 shadow-[0_2px_4px_rgba(0,0,0,0.02)] transition-colors">
                 <ChevronRight className="w-4 h-4" />
               </button>
               <h1 className="text-[18px] font-bold text-gray-900 ml-2 tracking-tight">
                 {formatDate(selectedDate)}
               </h1>
             </div>
           </div>

           {/* Calendar Table */}
           <div className="w-full max-w-3xl border border-[#ecece9] rounded-xl overflow-hidden bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02)] flex flex-col flex-1 min-h-0">
             
             {/* Table Header */}
             <div className="grid grid-cols-[80px_1fr] border-b border-[#ecece9] bg-[#fbfbfa] shrink-0">
               <div className="p-3 border-r border-[#ecece9] text-center text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                 Time
               </div>
               <div className="p-3 text-[13px] font-semibold text-gray-900">
                 Schedule
               </div>
             </div>

             {/* Table Body */}
             <div className="flex-1 overflow-y-auto relative custom-scrollbar bg-white">
               {/* 1. Grid Rows */}
               {hours.map((hour) => (
                 <div key={hour} className="grid grid-cols-[80px_1fr] border-b border-[#ecece9] last:border-b-0 h-[72px] group shrink-0">
                   <div className="p-0 border-r border-[#ecece9] text-center text-[11px] font-medium text-gray-500 pt-3 bg-[#fbfbfa]">
                     {hour > 12 ? hour - 12 : hour} {hour === 12 ? 'PM' : hour > 12 ? 'PM' : 'AM'}
                   </div>
                   <div className="hover:bg-gray-50/30 transition-colors w-full h-full"></div>
                 </div>
               ))}

               {/* 2. Events Overlay */}
               <div className="absolute top-0 bottom-0 left-[80px] right-0 pointer-events-none">
                 {hours.map((hour) => {
                   const hourEvents = todaysEvents.filter(e => e.startHour === hour);
                   if (hourEvents.length === 0) return null;

                   const topOffset = (hour - 9) * 72;

                   return (
                     <div key={`events-${hour}`} className="absolute inset-x-0 flex gap-2 px-2 items-start pointer-events-auto" style={{ top: `${topOffset + 8}px`, zIndex: 10 }}>
                       {hourEvents.map(event => {
                         const colors = getPlatformColors(event.type);
                         return (
                         <div key={event.id} 
                           onClick={() => handleEventClick(event)}
                           className={`flex-1 rounded-lg border ${colors.bg} ${colors.border} p-3 shadow-sm cursor-pointer transition-colors flex flex-col overflow-hidden`}
                           style={{
                             height: `calc(${event.duration * 72}px - 16px)`
                           }}
                         >
                           <div className="flex items-center justify-between mb-1.5">
                             <h4 className={`text-[13px] font-semibold ${colors.title}`}>{event.title}</h4>
                             <span className={`text-[11px] font-medium flex items-center gap-1 shrink-0 ml-2 px-1.5 py-0.5 rounded ${colors.time}`}>
                               <Clock className="w-3 h-3"/> 
                               {hour > 12 ? hour - 12 : hour}:00 - {event.startHour + event.duration > 12 && event.startHour + event.duration !== 12 ? event.startHour + event.duration - 12 : event.startHour + event.duration}:00
                             </span>
                           </div>
                           <div className="flex items-center justify-between mt-auto pt-2">
                             <p className={`text-[12px] flex items-center gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis mr-2 ${colors.text}`}>
                               <Video className="w-3.5 h-3.5 shrink-0"/> {event.type} • {event.participants} Participants
                             </p>
                             <button 
                               onClick={(e) => { e.stopPropagation(); /* Join logic */ }}
                               className={`text-[12px] font-medium px-2 py-0.5 rounded transition-colors shrink-0 shadow-sm border ${colors.btn}`}>
                               Join
                             </button>
                           </div>
                         </div>
                       )})}
                     </div>
                   );
                 })}
               </div>
             </div>
           </div>
        </div>

        {/* Notifications Sidebar */}
        <div className="w-[400px] border-l border-[#ecece9] bg-[#fbfbfa] flex flex-col overflow-y-auto shrink-0 custom-scrollbar">
          <div className="p-5 border-b border-[#ecece9] flex items-center gap-2 bg-white">
            <Bell className="w-4 h-4 text-gray-600" />
            <h3 className="text-[13px] font-semibold text-gray-800 tracking-tight">Updates</h3>
          </div>
          <div className="p-3 flex flex-col gap-1">
             {notifications.map(notif => (
               <div key={notif.id} className="p-3 rounded-lg hover:bg-gray-200/50 cursor-pointer transition-colors flex gap-3 group relative">
                 <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0 font-semibold text-gray-700 text-[13px]">
                   {notif.user.charAt(0)}
                 </div>
                 <div className="flex-1">
                   <p className="text-[13px] text-gray-800 leading-snug">
                     <span className="font-semibold">{notif.user}</span> {notif.text} <span className="font-medium text-gray-900 group-hover:underline">{notif.link}</span>
                   </p>
                   <p className="text-[11px] text-gray-500 mt-1">{notif.time}</p>
                 </div>
                 {notif.unread && (
                   <span className="absolute top-4 right-3 w-2 h-2 rounded-full bg-blue-500 border-2 border-[#fbfbfa]"></span>
                 )}
               </div>
             ))}
          </div>
        </div>

      </div>

      {/* Schedule Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl border border-[#ecece9] w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-[#ecece9] flex items-center justify-between bg-[#fbfbfa]">
              <h3 className="text-[15px] font-semibold text-gray-900">{editingEventId ? 'Edit Session' : 'Schedule Session'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors rounded-lg p-1 hover:bg-gray-100">
                 <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div>
                <label className="block text-[12px] font-medium text-gray-700 mb-1">Session Title / Topic</label>
                <input 
                  type="text" 
                  value={newEventObj.title}
                  onChange={e => setNewEventObj({...newEventObj, title: e.target.value})}
                  className="w-full text-[13px] border border-[#ecece9] rounded-lg px-3 py-2 outline-none focus:border-gray-400 transition-colors placeholder:text-gray-400 text-gray-900" 
                  placeholder="e.g., Weekly Sync" 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium text-gray-700 mb-1">Date</label>
                  <input 
                    type="date" 
                    value={newEventObj.date}
                    onChange={e => setNewEventObj({...newEventObj, date: e.target.value})}
                    className="w-full text-[13px] border border-[#ecece9] rounded-lg px-3 py-2 outline-none focus:border-gray-400 transition-colors text-gray-900" 
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-gray-700 mb-1">Time</label>
                  <select 
                    value={newEventObj.startHour}
                    onChange={e => setNewEventObj({...newEventObj, startHour: parseInt(e.target.value)})}
                    className="w-full text-[13px] border border-[#ecece9] rounded-lg px-3 py-2 outline-none focus:border-gray-400 transition-colors bg-white text-gray-900">
                    {hours.map(h => (
                      <option key={h} value={h}>{h > 12 ? h - 12 : h}:00 {h >= 12 ? 'PM' : 'AM'}</option>
                     ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium text-gray-700 mb-1">Duration</label>
                  <select 
                    value={newEventObj.duration}
                    onChange={e => setNewEventObj({...newEventObj, duration: parseInt(e.target.value)})}
                    className="w-full text-[13px] border border-[#ecece9] rounded-lg px-3 py-2 outline-none focus:border-gray-400 transition-colors bg-white text-gray-900">
                    {[1, 2, 3, 4, 5, 6].map(d => (
                      <option key={d} value={d}>{d} {d === 1 ? 'Hour' : 'Hours'}</option>
                    ))}
                  </select>
                </div>
                <div>
                   <label className="block text-[12px] font-medium text-gray-700 mb-1">Platform</label>
                   <select 
                    value={newEventObj.type}
                    onChange={e => setNewEventObj({...newEventObj, type: e.target.value})}
                    className="w-full text-[13px] border border-[#ecece9] rounded-lg px-3 py-2 outline-none focus:border-gray-400 transition-colors bg-white text-gray-900">
                     <option value="Zoom Room">Zoom Room</option>
                     <option value="Google Meet">Google Meet</option>
                     <option value="Microsoft Teams">Microsoft Teams</option>
                     <option value="In Person">In Person</option>
                     <option value="Phone Call">Phone Call</option>
                   </select>
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-gray-700 mb-1">Join Link</label>
                <input 
                  type="text" 
                  value={newEventObj.link}
                  onChange={e => setNewEventObj({...newEventObj, link: e.target.value})}
                  className="w-full text-[13px] border border-[#ecece9] rounded-lg px-3 py-2 outline-none focus:border-gray-400 transition-colors placeholder:text-gray-400 text-gray-900" 
                  placeholder="https://..." 
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[#ecece9] bg-[#fbfbfa] flex items-center justify-between gap-2">
              <div>
                {editingEventId && (
                  <button 
                    onClick={handleDelete}
                    className="text-[13px] font-medium text-red-600 px-4 py-2 rounded-lg hover:bg-red-50 border border-transparent transition-colors">
                    Delete Session
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="text-[13px] font-medium text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 border border-transparent transition-colors">
                  Cancel
                </button>
                <button 
                  onClick={handleSaveEvent}
                  className="text-[13px] font-medium text-white bg-gray-900 px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors shadow-[0_2px_4px_rgba(0,0,0,0.1)]">
                  {editingEventId ? 'Save Changes' : 'Schedule Session'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Side Panel for Session Details */}
      {isSidePanelOpen && selectedEvent && (
        <>
          <div 
            className="fixed inset-0 bg-black/10 z-40 transition-opacity"
            onClick={() => setIsSidePanelOpen(false)}
          />
          <div className="fixed top-0 right-0 bottom-0 w-[400px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out border-l border-[#ecece9] flex flex-col animate-in slide-in-from-right">
            
            <div className="h-14 border-b border-[#ecece9] flex items-center justify-between px-5 bg-[#fbfbfa] shrink-0">
              <h3 className="text-[15px] font-semibold text-gray-900">Session Details</h3>
              <button onClick={() => setIsSidePanelOpen(false)} className="text-gray-400 hover:text-gray-600 rounded-lg p-1.5 hover:bg-gray-100 transition-colors">
                 <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">{selectedEvent.title}</h2>
                <div className="flex items-center gap-2 text-[13px] text-gray-600">
                  <span className="flex items-center gap-1.5"><CalendarIcon className="w-4 h-4"/> {formatDate(new Date(selectedEvent.date))}</span>
                </div>
                <div className="flex items-center gap-2 text-[13px] text-gray-600 mt-2">
                  <span className="flex items-center gap-1.5"><Clock className="w-4 h-4"/> 
                    {selectedEvent.startHour > 12 ? selectedEvent.startHour - 12 : selectedEvent.startHour}:00 - 
                    {selectedEvent.startHour + selectedEvent.duration > 12 && selectedEvent.startHour + selectedEvent.duration !== 12 ? selectedEvent.startHour + selectedEvent.duration - 12 : selectedEvent.startHour + selectedEvent.duration}:00
                    ({selectedEvent.duration} {selectedEvent.duration === 1 ? 'Hour' : 'Hours'})
                  </span>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 border border-[#ecece9]">
                <div className="flex items-center gap-3 mb-4">
                   <div className="w-10 h-10 rounded-full bg-white border border-[#ecece9] flex items-center justify-center shadow-sm">
                     <Video className="w-5 h-5 text-gray-600" />
                   </div>
                   <div>
                     <p className="text-[12px] text-gray-500 font-medium">Platform</p>
                     <p className="text-[14px] font-semibold text-gray-900">{selectedEvent.type}</p>
                   </div>
                </div>
                {selectedEvent.link && (
                  <div className="pt-3 border-t border-[#ecece9]">
                     <p className="text-[12px] text-gray-500 font-medium mb-1">Join Link</p>
                     <a href={selectedEvent.link} target="_blank" rel="noreferrer" className="text-[13px] text-blue-600 hover:underline break-all">
                       {selectedEvent.link}
                     </a>
                  </div>
                )}
              </div>

              <div className="flex-1 flex flex-col">
                <h4 className="text-[13px] font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  Preparation Notes
                </h4>
                <textarea 
                  key={selectedEvent.id}
                  className="w-full flex-1 min-h-[140px] text-[13px] border border-[#ecece9] rounded-xl px-4 py-3 outline-none focus:border-gray-400 transition-colors resize-none placeholder:text-gray-400 text-gray-800 bg-gray-50/50"
                  placeholder="Write your meeting agenda, talking points, or prep notes here..."
                  defaultValue={selectedEvent.notes || ""}
                  onBlur={(e) => {
                    const newNotes = e.target.value;
                    const updatedEvents = events.map(ev => ev.id === selectedEvent.id ? { ...ev, notes: newNotes } : ev);
                    setEvents(updatedEvents);
                    setSelectedEvent({ ...selectedEvent, notes: newNotes });
                  }}
                ></textarea>
              </div>
            </div>

            <div className="p-5 border-t border-[#ecece9] bg-[#fbfbfa] flex items-center justify-between gap-3">
              <button 
                onClick={handleDeleteSession}
                className="text-[13px] font-medium text-red-600 hover:bg-red-50 px-4 py-2.5 rounded-lg transition-colors border border-transparent hover:border-red-100">
                Delete
              </button>
              <div className="flex items-center gap-2 flex-1 justify-end">
                <button 
                  onClick={() => {
                    handleEdit(selectedEvent);
                    setIsSidePanelOpen(false);
                  }}
                  className="text-[13px] font-medium text-gray-700 bg-white border border-[#ecece9] px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors shadow-sm">
                  Edit
                </button>
                <button 
                  onClick={() => {
                    if (selectedEvent.link) {
                      window.open(selectedEvent.link, '_blank');
                    } else {
                      alert("No join link provided for this session.");
                    }
                  }}
                  className="text-[13px] font-medium text-gray-700 bg-white border border-[#ecece9] px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors shadow-sm">
                  Join
                </button>
                <button 
                  onClick={() => alert("Session ended")}
                  className="text-[13px] font-medium text-white bg-red-600 px-4 py-2.5 rounded-lg hover:bg-red-700 transition-colors shadow-sm">
                  End Session
                </button>
              </div>
            </div>

          </div>
        </>
      )}
    </div>
  );
}
