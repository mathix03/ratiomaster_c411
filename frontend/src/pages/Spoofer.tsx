import React, { useState, useEffect, useRef } from 'react';
import { Upload, Play, Square, Activity, Wifi, Settings, AlertTriangle, Clock, HardDrive, TrendingUp, Terminal, ShieldAlert, Maximize2, Minimize2, Search, Image as ImageIcon } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import '../App.css';
import { fetchWithAuth } from '../utils/api';
import { useUI } from '../context/UIContext';
function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec: number) {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function Spoofer() {
  const [stagedTorrents, setStagedTorrents] = useState<any[]>([]);
  const [selectedTracker, setSelectedTracker] = useState('');
  const [client, setClient] = useState('qBittorrent');
  const MIN_UPLOAD_MBPS = 1;
  const MAX_UPLOAD_MBPS = 50;
  const [baseUploadSpeed, setBaseUploadSpeed] = useState(5); // MB/s, clamped to 1–50
  const [stopAtSizeMB, setStopAtSizeMB] = useState<number | ''>('');
  const [stopAtTimeMins, setStopAtTimeMins] = useState<number | ''>('');
  const [useSequence, setUseSequence] = useState<boolean>(true);
  const [sequenceLoops, setSequenceLoops] = useState<number>(24); // default 24 loops
  const [initialUploadedGB, setInitialUploadedGB] = useState<number | ''>('');
  const [initialDownloadedGB, setInitialDownloadedGB] = useState<number | ''>('');
  const [instancesCount, setInstancesCount] = useState<number>(1);
  
  // Jellyfin integration
  const [jellyfinSearchQuery, setJellyfinSearchQuery] = useState('');
  const [jellyfinResults, setJellyfinResults] = useState<any[]>([]);
  const [selectedJellyfinItem, setSelectedJellyfinItem] = useState<any>(null);
  const [isSearchingJellyfin, setIsSearchingJellyfin] = useState(false);

  const [sessions, setSessions] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [uptimeStr, setUptimeStr] = useState('00:00:00');
  const [logs, setLogs] = useState<any[]>([]);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const { toast, confirm } = useUI();

  // Handle Wake Lock via backend caffeinate
  useEffect(() => {
    fetchWithAuth('/caffeinate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: keepAwake })
    }).catch(err => console.error('Failed to set keep awake on server:', err));
  }, [keepAwake]);

  // Update Uptime every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (sessions.length > 0) {
        // sessions have startTime
        const minStartTime = Math.min(...sessions.map(s => s.startTime));
        const elapsed = Math.floor((Date.now() - minStartTime) / 1000);
        setUptimeStr(formatTime(elapsed));
      } else {
        setUptimeStr('00:00:00');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sessions]);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetchWithAuth('/sessions');
        if (res.ok) {
          const data = await res.json();
          setSessions(data);
          
          setHistoryData(prev => {
            const totalSpeed = data.reduce((acc: number, s: any) => acc + (s.status === 'running' ? s.currentUploadSpeed : 0), 0);
            const totalUploaded = data.reduce((acc: number, s: any) => acc + (s.uploaded || 0), 0);
            const now = new Date();
            const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
            const newPoint = { time: timeStr, speed: totalSpeed, uploaded: totalUploaded };
            const next = [...prev, newPoint];
            return next.slice(-60); // Keep last 60 seconds
          });
        }
        
        const logsRes = await fetchWithAuth('/logs');
        if (logsRes.ok) {
          const logsData = await logsRes.json();
          setLogs(logsData);
        }
      } catch (e) {
        console.error("Failed to fetch data");
      }
    };
    
    fetchSessions(); // initial fetch
    const interval = setInterval(fetchSessions, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleFileUpload = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const newStaged: any[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || !file.name.endsWith('.torrent')) {
        toast(`File ${file.name} is not a valid .torrent file`, 'error');
        continue;
      }

      const formData = new FormData();
      formData.append('torrent', file);

      try {
        const res = await fetchWithAuth('/torrent/parse', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.error) {
          toast(`Error parsing ${file.name}: ${data.error}`, 'error');
        } else {
          newStaged.push(data);
        }
      } catch (err: any) {
        toast(`Error parsing ${file.name}: ${err.message}`, 'error');
      }
    }
    
    if (newStaged.length > 0) {
      setStagedTorrents(prev => {
        const updated = [...prev, ...newStaged];
        if (updated.length === 1) {
          if (updated[0].trackers && updated[0].trackers.length > 0) {
            setSelectedTracker(updated[0].trackers.flat()[0]);
          }
          // Pre-fill Jellyfin search with sanitized torrent name
          const cleanName = updated[0].name.replace(/\.[^/.]+$/, "").replace(/[\.\-_\[\]]/g, " ").trim();
          setJellyfinSearchQuery(cleanName);
          setSelectedJellyfinItem(null);
          setJellyfinResults([]);
        }
        return updated;
      });
    }
  };

  const searchJellyfin = async () => {
    if (!jellyfinSearchQuery) return;
    setIsSearchingJellyfin(true);
    try {
      const res = await fetchWithAuth(`/jellyfin/search?query=${encodeURIComponent(jellyfinSearchQuery)}`);
      const data = await res.json();
      if (data.results) {
        setJellyfinResults(data.results);
      } else {
        toast(data.error || 'Failed to search Jellyfin. Is it configured in Settings?', 'error');
      }
    } catch (err: any) {
      toast('Jellyfin search error: ' + err.message, 'error');
    }
    setIsSearchingJellyfin(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleStart = async () => {
    if (stagedTorrents.length === 0) return;
    
    let started = 0;
    let quotaError = '';
    for (const torrent of stagedTorrents) {
        for (let i = 0; i < instancesCount; i++) {
          const res = await fetchWithAuth('/session/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              infoHash: torrent.infoHash,
              name: instancesCount > 1 ? `${torrent.name} [Inst ${i+1}]` : torrent.name,
              tracker: selectedTracker || torrent.trackers[0],
              client,
              baseUploadSpeed: baseUploadSpeed * 1024 * 1024,
              stopAtSizeMB,
              stopAtTimeMins,
              useSequence,
              sequenceLoops,
              initialUploadedGB,
              initialDownloadedGB,
              posterUrl: selectedJellyfinItem?.posterUrl,
              jellyfinItemId: selectedJellyfinItem?.id
            })
          });
          if (res.ok) {
            started++;
          } else {
            const data = await res.json().catch(() => ({}));
            quotaError = data.error || 'Failed to start session';
          }
        }
      }

    if (quotaError) toast(quotaError, 'error');
    if (started > 0) toast(`${started} session${started > 1 ? 's' : ''} started`, 'success');

    // Clear staging area so user can add another
    setStagedTorrents([]);
    setSelectedJellyfinItem(null);
    setJellyfinResults([]);
    setJellyfinSearchQuery('');
  };

  const handleStop = async (sessionId: string) => {
    try {
      await fetchWithAuth('/session/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
    } catch (err: any) {
      toast("Error stopping session: " + err.message, 'error');
    }
  };

  const handleRemove = async (sessionId: string) => {
    try {
      await fetchWithAuth('/session/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
    } catch (err: any) {
      toast("Error removing session: " + err.message, 'error');
    }
  };

  const handleStopAll = async () => {
    const ok = await confirm({
      title: 'Stop all sessions',
      message: 'This will immediately stop ALL of your active sessions. Continue?',
      confirmLabel: 'Stop all',
      danger: true
    });
    if (ok) {
      await fetchWithAuth('/sessions/stop-all', { method: 'POST' });
      toast('All your sessions stopped', 'success');
    }
  };

  return (
    <div className="app-container">
      {isTerminalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ color: '#0f0', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Terminal size={28} /> System Logs - Expanded View</h2>
            <button onClick={() => setIsTerminalOpen(false)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer', padding: '0.5rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Minimize2 size={20} /> Close
            </button>
          </div>
          <div style={{ flex: 1, background: '#000', borderRadius: '8px', padding: '1.5rem', fontFamily: 'monospace', fontSize: '1rem', color: '#0f0', overflowY: 'auto', display: 'flex', flexDirection: 'column-reverse', border: '1px solid rgba(0, 255, 0, 0.2)', boxShadow: '0 0 20px rgba(0, 255, 0, 0.1)' }}>
            {logs.slice().reverse().map((log, idx) => (
              <div key={idx} style={{ marginBottom: '0.5rem', opacity: log.type === 'error' || log.type === 'warning' ? 1 : 0.8, lineHeight: '1.5' }}>
                <span style={{ color: '#888' }}>[{log.time}]</span>{' '}
                <span style={{ color: '#0af' }}>[{log.sessionId}]</span>{' '}
                <span style={{ color: log.type === 'error' ? '#f44' : log.type === 'warning' ? '#fa0' : log.type === 'success' ? '#0f0' : '#fff' }}>
                  {log.message}
                </span>
              </div>
            ))}
            {logs.length === 0 && <div style={{ color: '#666' }}>Awaiting system events...</div>}
          </div>
        </div>
      )}

      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Activity size={40} className="icon-ghost" />
          <h1>GhostSeed Pro</h1>
        </div>
        
        <div className="global-stats" style={{ display: 'flex', gap: '2rem', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '0.8rem 1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
          {sessions.length > 0 && (
            <button 
              onClick={handleStopAll} 
              className="btn btn-panic"
              style={{ marginRight: '1rem', padding: '0.8rem 1.5rem' }}
            >
              <ShieldAlert size={20} /> PANIC STOP ALL
            </button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Global Speed</span>
            <span style={{ fontSize: '1.2rem', color: 'var(--primary)', fontWeight: 'bold' }}>
              {formatSpeed(sessions.reduce((acc, s) => acc + (s.status === 'running' ? s.currentUploadSpeed : 0), 0))}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Uploaded (Sessions)</span>
            <span style={{ fontSize: '1.2rem', color: 'var(--success)', fontWeight: 'bold' }}>
              {formatBytes(sessions.reduce((acc, s) => acc + (s.uploaded || 0), 0))}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Uptime</span>
            <span style={{ fontSize: '1.2rem', color: '#fff', fontWeight: 'bold' }}>
              {uptimeStr}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <input type="checkbox" checked={keepAwake} onChange={e => setKeepAwake(e.target.checked)} style={{ transform: 'scale(1.2)' }} />
              Keep Awake
            </label>
          </div>
        </div>
      </header>

      <div className="dashboard">
        
        {/* Staging Area for new torrents */}
        <div className="glass-panel staging-area">
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <h2 className="section-title">Add New Torrent</h2>
            <input 
              type="file" 
              multiple
              ref={fileInputRef} 
              onChange={(e) => e.target.files && handleFileUpload(e.target.files)} 
              style={{ display: 'none' }} 
              accept=".torrent" 
            />
            
            {stagedTorrents.length === 0 ? (
              <div 
                className={`dropzone ${isDragging ? 'active' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={48} className="icon" />
                <h3>Drag & Drop .torrent(s)</h3>
                <p>or click to browse</p>
              </div>
            ) : (
              <div className="torrent-info">
                {stagedTorrents.length === 1 ? (
                  <>
                    <div className="torrent-name">{stagedTorrents[0].name || "Unknown Torrent"}</div>
                    <div className="torrent-meta">
                      Size: {formatBytes(stagedTorrents[0].length)} | Hash: {stagedTorrents[0].infoHash.substring(0, 10)}...
                    </div>
                  </>
                ) : (
                  <>
                    <div className="torrent-name">{stagedTorrents.length} Torrents Ready</div>
                    <div className="torrent-meta">
                      Total Size: {formatBytes(stagedTorrents.reduce((acc, t) => acc + (t.length || 0), 0))}
                    </div>
                  </>
                )}
                <button className="btn btn-secondary" style={{ marginTop: '1rem', padding: '0.5rem' }} onClick={() => setStagedTorrents([])}>
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="config-panel" style={{ opacity: stagedTorrents.length > 0 ? 1 : 0.5, pointerEvents: stagedTorrents.length > 0 ? 'auto' : 'none' }}>
            <div className="form-group">
              <label><Wifi size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }}/> Target Tracker</label>
              {stagedTorrents.length > 1 ? (
                <div style={{ padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', color: 'var(--success)' }}>
                  Auto-selecting primary trackers for each file
                </div>
              ) : (
                <select className="form-control" value={selectedTracker} onChange={(e) => setSelectedTracker(e.target.value)}>
                  {stagedTorrents.length === 1 && stagedTorrents[0].trackers ? (
                    stagedTorrents[0].trackers.flat().map((tr: string, i: number) => (
                      <option key={i} value={tr}>{tr}</option>
                    ))
                  ) : <option value="">-</option>}
                </select>
              )}
            </div>

            <div className="form-group">
              <label><Settings size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }}/> Emulated Client</label>
              <select className="form-control" value={client} onChange={(e) => setClient(e.target.value)}>
                <option value="qBittorrent">qBittorrent 4.3.5</option>
                <option value="Transmission">Transmission 3.00</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label><HardDrive size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }}/> Auto-stop (MB)</label>
                <input type="number" className="form-control" placeholder="No limit" value={stopAtSizeMB} onChange={e => setStopAtSizeMB(e.target.value ? parseInt(e.target.value) : '')} />
              </div>
              <div className="form-group">
                <label><Clock size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }}/> Auto-stop (Mins)</label>
                <input type="number" className="form-control" placeholder="No limit" value={stopAtTimeMins} onChange={e => setStopAtTimeMins(e.target.value ? parseInt(e.target.value) : '')} />
              </div>
            </div>

            <div className="form-group" style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#fff', textTransform: 'none', fontSize: '1rem' }}>
                <input type="checkbox" checked={useSequence} onChange={e => setUseSequence(e.target.checked)} style={{ transform: 'scale(1.2)' }} />
                Enable Human Sequence Loop (4m/2m/10m...)
              </label>
              {useSequence && (
                <div style={{ marginTop: '1rem' }}>
                  <label>Number of Loops</label>
                  <input type="number" className="form-control" min="1" value={sequenceLoops} onChange={e => setSequenceLoops(parseInt(e.target.value) || 1)} />
                </div>
              )}
            </div>

            <div className="form-group" style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
              <label style={{ marginBottom: '0.5rem' }}>Live Ratio Simulator (Optional)</label>
              <div className="form-row">
                <div className="form-group">
                  <input type="number" className="form-control" placeholder="Current Upload (GB)" value={initialUploadedGB} onChange={e => setInitialUploadedGB(e.target.value ? parseFloat(e.target.value) : '')} />
                </div>
                <div className="form-group">
                  <input type="number" className="form-control" placeholder="Current Download (GB)" value={initialDownloadedGB} onChange={e => setInitialDownloadedGB(e.target.value ? parseFloat(e.target.value) : '')} />
                </div>
              </div>
            </div>

            <div className="form-group" style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
              <label><Upload size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Base Upload Speed</label>
              <div className="speed-slider">
                <input
                  type="range"
                  min={MIN_UPLOAD_MBPS}
                  max={MAX_UPLOAD_MBPS}
                  step="1"
                  value={baseUploadSpeed}
                  onChange={e => setBaseUploadSpeed(Number(e.target.value))}
                  style={{
                    background: `linear-gradient(90deg, var(--accent-color) 0%, var(--accent-color) ${((baseUploadSpeed - MIN_UPLOAD_MBPS) / (MAX_UPLOAD_MBPS - MIN_UPLOAD_MBPS)) * 100}%, rgba(255,255,255,0.12) ${((baseUploadSpeed - MIN_UPLOAD_MBPS) / (MAX_UPLOAD_MBPS - MIN_UPLOAD_MBPS)) * 100}%, rgba(255,255,255,0.12) 100%)`
                  }}
                />
                <span className="speed-display">{baseUploadSpeed} MB/s</span>
              </div>
              <div className="speed-range-labels">
                <span>{MIN_UPLOAD_MBPS} MB/s</span>
                <span>{MAX_UPLOAD_MBPS} MB/s</span>
              </div>
            </div>

            <div className="form-group" style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
              <label style={{ marginBottom: '0.5rem' }}>Multiply Sessions (Launch multiple times)</label>
              <input type="number" className="form-control" min="1" max="100" value={instancesCount} onChange={e => setInstancesCount(parseInt(e.target.value) || 1)} />
            </div>

            <div className="form-group" style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
              <label style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ImageIcon size={16} /> Assign Jellyfin Metadata (Optional)
              </label>
              
              {selectedJellyfinItem ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(255,255,255,0.05)', padding: '0.5rem', borderRadius: '8px' }}>
                  {selectedJellyfinItem.posterUrl ? (
                    <img src={selectedJellyfinItem.posterUrl} alt="Poster" style={{ width: '40px', height: '60px', objectFit: 'cover', borderRadius: '4px' }} />
                  ) : (
                    <div style={{ width: '40px', height: '60px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ImageIcon size={20} color="#888" />
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{selectedJellyfinItem.name}</div>
                    <div style={{ fontSize: '0.8rem', color: '#888' }}>{selectedJellyfinItem.type} {selectedJellyfinItem.productionYear ? `(${selectedJellyfinItem.productionYear})` : ''}</div>
                  </div>
                  <button className="btn btn-secondary" style={{ padding: '0.5rem' }} onClick={() => setSelectedJellyfinItem(null)}>Clear</button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="Search Jellyfin..." 
                      value={jellyfinSearchQuery} 
                      onChange={e => setJellyfinSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && searchJellyfin()}
                    />
                    <button className="btn btn-secondary" onClick={searchJellyfin} disabled={isSearchingJellyfin}>
                      <Search size={18} />
                    </button>
                  </div>
                  {jellyfinResults.length > 0 && (
                    <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                      {jellyfinResults.map(item => (
                        <div 
                          key={item.id} 
                          style={{ cursor: 'pointer', textAlign: 'center', background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '8px', border: '1px solid transparent', transition: 'border-color 0.2s' }}
                          onClick={() => {
                            setSelectedJellyfinItem(item);
                            setJellyfinResults([]);
                          }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                          onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                        >
                          {item.posterUrl ? (
                            <img src={item.posterUrl} alt={item.name} style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', borderRadius: '4px', marginBottom: '0.5rem' }} />
                          ) : (
                            <div style={{ width: '100%', aspectRatio: '2/3', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <ImageIcon size={24} color="#888" />
                            </div>
                          )}
                          <div style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                          <div style={{ fontSize: '0.65rem', color: '#888' }}>{item.productionYear || 'Unknown'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="actions">
              <button className="btn btn-start" onClick={handleStart} disabled={stagedTorrents.length === 0}>
                <Play size={20} /> START SPOOFING {stagedTorrents.length > 1 || instancesCount > 1 ? `(${stagedTorrents.length * instancesCount} Sessions)` : ''}
              </button>
            </div>
          </div>
        </div>

        {sessions.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h2 className="section-title"><TrendingUp size={24} /> Live Analytics</h2>
              <div style={{ height: '300px', width: '100%', marginTop: '1rem' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={historyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent-color)" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="var(--accent-color)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" stroke="var(--text-muted)" tick={{fill: 'var(--text-muted)'}} />
                    <YAxis tickFormatter={(val) => formatSpeed(val)} stroke="var(--text-muted)" tick={{fill: 'var(--text-muted)'}} width={80} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: 'var(--accent-color)', borderRadius: '8px', color: '#fff' }}
                      formatter={(value: any, name: any) => [
                        name === 'speed' ? formatSpeed(Number(value)) : formatBytes(Number(value)), 
                        name === 'speed' ? 'Global Speed' : 'Total Uploaded'
                      ]}
                    />
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <Area type="monotone" dataKey="speed" stroke="var(--accent-color)" strokeWidth={3} fillOpacity={1} fill="url(#colorSpeed)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="section-title" style={{ margin: 0 }}><Terminal size={24} /> Live Terminal Logs</h2>
                <button onClick={() => setIsTerminalOpen(true)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} title="Expand to fullscreen">
                  <Maximize2 size={20} />
                </button>
              </div>
              <div style={{ background: '#000', borderRadius: '8px', padding: '1rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#0f0', overflowY: 'auto', marginTop: '1rem', height: '300px', maxHeight: '300px', display: 'flex', flexDirection: 'column-reverse' }}>
                {logs.slice().reverse().map((log, idx) => (
                  <div key={idx} style={{ marginBottom: '0.3rem', opacity: log.type === 'error' || log.type === 'warning' ? 1 : 0.8 }}>
                    <span style={{ color: '#888' }}>[{log.time}]</span>{' '}
                    <span style={{ color: '#0af' }}>[{log.sessionId}]</span>{' '}
                    <span style={{ color: log.type === 'error' ? '#f44' : log.type === 'warning' ? '#fa0' : log.type === 'success' ? '#0f0' : '#fff' }}>
                      {log.message}
                    </span>
                  </div>
                ))}
                {logs.length === 0 && <div style={{ color: '#666' }}>Awaiting system events...</div>}
              </div>
            </div>
          </div>
        )}

        <div className="active-sessions">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2>Active Sessions ({sessions.length})</h2>
          </div>
          {sessions.length === 0 ? (
            <div className="no-sessions">No active spoofing sessions.</div>
          ) : (
            <div className="sessions-grid">
              {sessions.map(session => (
                <div key={session.id} className={`glass-panel session-card ${session.status === 'stopped' ? 'stopped' : ''}`}>
                  <div className="card-header" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    {session.posterUrl ? (
                      <img src={session.posterUrl} alt="Poster" style={{ width: '48px', height: '72px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: '48px', height: '72px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <ImageIcon size={20} color="#555" />
                      </div>
                    )}
                    <div style={{ minWidth: 0, overflow: 'hidden' }}>
                      <div className="card-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.name}</div>
                      <div className="card-tracker" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{new URL(session.tracker).hostname}</div>
                    </div>
                  </div>
                  
                  <div className="status-badge" style={{ 
                    background: session.sequenceState === 'safety_pause' ? 'rgba(239, 68, 68, 0.2)' 
                              : session.sequenceState === 'pause' ? 'rgba(245, 158, 11, 0.2)' 
                              : 'rgba(16, 185, 129, 0.2)',
                    color: session.sequenceState === 'safety_pause' ? 'var(--danger)' 
                         : session.sequenceState === 'pause' ? 'var(--warning)' 
                         : 'var(--success)',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    animation: session.sequenceState === 'safety_pause' ? 'pulse 2s infinite' : 'none'
                  }}>
                    {session.sequenceState === 'safety_pause' ? '⚠️ SAFETY PAUSE (0 Leechers)' : session.sequenceState.toUpperCase()}
                  </div>

                  <div className="stats-grid">
                    <div className="stat-item">
                      <label>Time</label>
                      <span className="accent">{formatTime((Date.now() - session.startTime) / 1000)}</span>
                    </div>
                    <div className="stat-item">
                      <label>Current Speed</label>
                      <span>{session.status === 'running' ? formatSpeed(session.currentUploadSpeed) : '0 Bytes/s'}</span>
                    </div>
                    <div className="stat-item">
                      <label>Uploaded</label>
                      <span>{formatBytes(session.uploaded || 0)}</span>
                    </div>
                    <div className="stat-item">
                      <label>Next Announce</label>
                      <span>{session.status === 'running' ? formatTime((session.nextAnnounceInMs || 0) / 1000) : '--'}</span>
                    </div>
                  </div>

                  {session.leechers !== -1 && (
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
                      <div>Seeders: <strong>{session.seeders}</strong></div>
                      <div>Leechers: <strong>{session.leechers}</strong></div>
                    </div>
                  )}

                  {session.leechers === 0 && session.status === 'running' && (
                    <div className="leechers-warning">
                      <AlertTriangle size={16} /> 0 Leechers! High risk of detection.
                    </div>
                  )}

                  {/* Ratio Display */}
                  {(session as any).initialDownloadedGB > 0 && (
                    <div style={{ marginTop: '0.5rem', background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Live Tracker Ratio</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--accent-color)' }}>
                        {(((session as any).initialUploadedGB * 1024 * 1024 * 1024 + session.uploaded) / ((session as any).initialDownloadedGB * 1024 * 1024 * 1024)).toFixed(3)}
                        <span style={{ fontSize: '1rem', marginLeft: '4px' }}>↗</span>
                      </div>
                    </div>
                  )}

                  {session.status === 'running' && (
                    <button className="btn btn-stop" style={{ padding: '0.75rem', fontSize: '0.9rem', marginTop: '0.5rem' }} onClick={() => handleStop(session.id)}>
                      <Square size={16} /> STOP
                    </button>
                  )}
                  {session.status === 'stopped' && (
                    <button className="btn btn-secondary" style={{ padding: '0.75rem', fontSize: '0.9rem', marginTop: '0.5rem' }} onClick={() => handleRemove(session.id)}>
                      REMOVE
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
