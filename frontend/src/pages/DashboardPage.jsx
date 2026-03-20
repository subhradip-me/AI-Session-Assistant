import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { uploadFile } from '../slices/sessionSlice';
import { IconPlus, IconLink, IconUpload } from '../components/Icons';
import Button from '../components/Button';
import Input from '../components/Input';

const DashboardPage = () => {
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { uploading } = useSelector((state) => state.session);

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    const result = await dispatch(uploadFile(selectedFile));
    if (uploadFile.fulfilled.match(result)) {
      navigate(`/session/${result.payload.sessionId}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-12 flex flex-col items-center">
      <div className="max-w-3xl w-full flex flex-col items-center">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-4 tracking-tight">How can I assist you?</h2>
          <p className="text-lg text-[#9E9E9B] font-medium">Upload a meeting recording or paste a URL to generate intelligence.</p>
        </div>

        {/* Input Cards */}
        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 mb-24">
          <div className="p-6 bg-white border border-[#EDEDEB] rounded-xl hover:border-[#D1D1CE] transition-notion cursor-pointer group shadow-sm hover:shadow-md">
            <div className="w-10 h-10 rounded-lg bg-[#F5F5F4] flex items-center justify-center mb-4 text-[#37352F] group-hover:bg-[#EBEAE4] transition-notion">
              <IconLink />
            </div>
            <h3 className="font-semibold mb-2">Source URL</h3>
            <p className="text-sm text-[#9E9E9B] mb-4 leading-relaxed line-clamp-2">Paste a link to a video or audio file to start processing.</p>
            <Input 
              placeholder="https://example.com/video.mp4"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="p-6 bg-white border border-[#EDEDEB] rounded-xl hover:border-[#D1D1CE] transition-notion cursor-pointer group shadow-sm hover:shadow-md flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-lg bg-[#F5F5F4] flex items-center justify-center mb-4 text-[#37352F] group-hover:bg-[#EBEAE4] transition-notion">
                <IconUpload />
              </div>
              <h3 className="font-semibold mb-2">Local File</h3>
              <p className="text-sm text-[#9E9E9B] mb-6 leading-relaxed">Upload a recording directly from your computer (.mp4, .wav, .mp3).</p>
            </div>
            <label className="w-full">
              <input 
                type="file" 
                className="hidden" 
                accept="video/*,audio/*"
                onChange={handleFileUpload}
                disabled={uploading}
              />
              <div className={`w-full py-2 bg-[#37352F] text-white rounded-md text-sm font-medium hover:bg-[#2F2E2A] transition-notion flex items-center justify-center cursor-pointer ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <IconPlus />
                <span className="ml-2">{uploading ? 'Uploading...' : 'Select File'}</span>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
