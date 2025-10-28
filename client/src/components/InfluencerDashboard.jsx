import { useState, useEffect } from 'react';
import { web3Service } from '../utils/web3.js';
import api from '../utils/api.js';

const InfluencerDashboard = ({ walletAddress }) => {
  const [profile, setProfile] = useState({
    youtubeChannelId: '',
    youtubeChannelName: '',
    email: '',
    isChannelVerified: false,
    verificationCode: ''
  });
  const [registeredCampaigns, setRegisteredCampaigns] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submissionForm, setSubmissionForm] = useState({
    campaignId: '',
    youtubeUrl: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [verifyingVideo, setVerifyingVideo] = useState(false);
  const [showAIDetails, setShowAIDetails] = useState(null);
  const [aiDetails, setAiDetails] = useState(null);
  const [loadingAIDetails, setLoadingAIDetails] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, [walletAddress]);

  const loadDashboardData = async () => {
    try {
      // Load existing profile data
      try {
        const profileResponse = await api.get(`/api/influencers/${walletAddress}`);
        setProfile({
          youtubeChannelId: profileResponse.data.youtubeChannelId || '',
          youtubeChannelName: profileResponse.data.youtubeChannelName || '',
          email: profileResponse.data.email || '',
          isChannelVerified: profileResponse.data.isChannelVerified || false,
          verificationCode: profileResponse.data.verificationCode || ''
        });
      } catch (error) {
        // Profile doesn't exist yet, keep empty form
        console.log('No existing profile found');
      }

      // Load registered campaigns
      const activeCampaigns = await web3Service.getActiveCampaigns();

      const registeredCampaignsPromises = activeCampaigns.map(async (campaignId) => {
        const isRegistered = await web3Service.isInfluencerRegistered(campaignId, walletAddress);
        if (isRegistered) {
          const [campaignInfo, dbInfo] = await Promise.all([
            web3Service.getCampaignInfo(campaignId),
            api.get(`/api/campaigns/${campaignId}`).catch(() => ({ data: null }))
          ]);

          return {
            id: campaignId,
            ...campaignInfo,
            ...dbInfo.data
          };
        }
        return null;
      });

      const registeredCampaignsData = (await Promise.all(registeredCampaignsPromises)).filter(Boolean);
      setRegisteredCampaigns(registeredCampaignsData);

      // Load user's submissions
      if (registeredCampaignsData.length > 0) {
        try {
          const submissionsPromises = registeredCampaignsData.map(async (campaign) => {
            try {
              const response = await api.get(`/api/campaigns/${campaign.id}/submissions`);
              return response.data.filter(submission =>
                submission.wallet_address.toLowerCase() === walletAddress.toLowerCase()
              ).map(submission => ({
                ...submission,
                campaign_title: campaign.title || `Campaign #${campaign.id}`
              }));
            } catch (error) {
              return [];
            }
          });

          const allSubmissions = (await Promise.all(submissionsPromises)).flat();
          setSubmissions(allSubmissions);
        } catch (error) {
          console.error('Error loading submissions:', error);
        }
      }

    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateVerificationCode = () => {
    const code = 'CAMPAYN-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    setProfile({...profile, verificationCode: code});
    setShowVerification(true);
  };

  const handleVerifyChannel = async () => {
    if (!profile.verificationCode) {
      alert('Please generate a verification code first');
      return;
    }

    setVerifying(true);
    try {
      const response = await api.post('/api/influencers/verify-channel', {
        walletAddress,
        youtubeChannelId: profile.youtubeChannelId,
        verificationCode: profile.verificationCode
      });

      setProfile({...profile, isChannelVerified: true});
      setShowVerification(false);
      alert('Channel verified successfully!');
    } catch (error) {
      console.error('Error verifying channel:', error);
      alert(error.response?.data?.error || 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/influencers', {
        walletAddress,
        youtubeChannelId: profile.youtubeChannelId,
        youtubeChannelName: profile.youtubeChannelName,
        email: profile.email
      });
      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Error updating profile:', error);

      if (error.response?.data?.field === 'youtubeChannelId') {
        const existing = error.response.data.existingUser;
        alert(`This YouTube Channel ID is already registered!\n\nExisting user:\n• Channel: ${existing.channelName}\n• Wallet: ${existing.walletAddress}\n\nPlease use a different YouTube channel.`);
      } else if (error.response?.data?.field === 'email') {
        const existing = error.response.data.existingUser;
        alert(`This email is already registered!\n\nExisting user:\n• Channel: ${existing.channelName}\n• Wallet: ${existing.walletAddress}\n\nPlease use a different email address.`);
      } else {
        alert(error.response?.data?.error || 'Failed to update profile. Please try again.');
      }
    }
  };

  const verifyVideoOwnership = async (youtubeUrl) => {
    if (!profile.youtubeChannelId) {
      alert('Please set your YouTube Channel ID in your profile first.');
      return false;
    }

    if (!profile.isChannelVerified) {
      // Just warn but allow to continue, like channel verification pattern
      console.log('Warning: Channel not verified, but allowing video verification');
    }

    try {
      setVerifyingVideo(true);

      // Extract video ID from URL
      const videoIdMatch = youtubeUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
      if (!videoIdMatch) {
        alert('Invalid YouTube URL. Please provide a valid YouTube video URL.');
        return false;
      }

      const videoId = videoIdMatch[1];

      // Check if video belongs to user's channel
      const response = await api.post('/api/influencers/verify-video-ownership', {
        videoId,
        expectedChannelId: profile.youtubeChannelId,
        walletAddress
      });

      if (response.data.isOwner) {
        alert('Video ownership verified successfully! You can proceed with submission.');
        return true;
      } else {
        alert(`Video ownership mismatch! This video belongs to channel "${response.data.actualChannelTitle}" but your registered channel is different. Please submit videos from your own channel.`);
        return false;
      }

    } catch (error) {
      console.error('Error verifying video ownership:', error);

      if (error.response?.status === 404) {
        alert('Video not found. The video could not be found or may be private. Please check the URL.');
        return false;
      } else if (error.response?.status === 403) {
        alert('Video access restricted. Unable to verify video ownership due to privacy settings.');
        return false;
      } else {
        alert(error.response?.data?.error || 'Could not verify video ownership, but you can still proceed. Manual review may be required.');
        // Allow submission even if verification fails (network issues, etc.)
        return true;
      }
    } finally {
      setVerifyingVideo(false);
    }
  };

  const handleSubmissionSubmit = async (e) => {
    e.preventDefault();

    // First verify video ownership
    const isVideoValid = await verifyVideoOwnership(submissionForm.youtubeUrl);
    if (!isVideoValid) {
      return; // Don't proceed if verification fails
    }

    setSubmitting(true);

    try {
      const response = await api.post('/api/submissions', {
        campaignId: submissionForm.campaignId,
        walletAddress,
        youtubeUrl: submissionForm.youtubeUrl
      });

      alert('Video submitted successfully!');
      setSubmissionForm({ campaignId: '', youtubeUrl: '' });

      const newSubmission = {
        ...response.data,
        campaign_title: registeredCampaigns.find(c => c.id == submissionForm.campaignId)?.title || `Campaign #${submissionForm.campaignId}`
      };

      console.log('New submission data:', newSubmission); // Debug log
      setSubmissions(prev => [newSubmission, ...prev]);

      // Reload dashboard data to ensure we have the latest information
      setTimeout(() => {
        loadDashboardData();
      }, 1000);

    } catch (error) {
      console.error('Error submitting video:', error);

      if (error.response?.data?.existingSubmission) {
        const existing = error.response.data.existingSubmission;
        const submittedDate = new Date(existing.submittedAt).toLocaleDateString();
        alert(`You have already submitted a video for this campaign on ${submittedDate}. Only one submission per campaign is allowed.\n\nYour existing submission: ${existing.youtubeUrl}\nPerformance Score: ${Math.round(existing.performanceScore || 0)}`);
      } else {
        alert(error.response?.data?.error || 'Failed to submit video. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const fetchAIVerificationDetails = async (submissionId) => {
    setLoadingAIDetails(true);
    try {
      const response = await api.get(`/api/submissions/${submissionId}/ai-verification`);
      setAiDetails(response.data);
      setShowAIDetails(submissionId);
    } catch (error) {
      console.error('Error fetching AI verification details:', error);
      alert('Failed to load AI verification details');
    } finally {
      setLoadingAIDetails(false);
    }
  };

  const retryAIVerification = async (submissionId) => {
    try {
      await api.post(`/api/submissions/${submissionId}/verify`);
      alert('AI verification has been triggered again. Results will be updated shortly.');

      // Reload dashboard data after a few seconds
      setTimeout(() => {
        loadDashboardData();
      }, 3000);
    } catch (error) {
      console.error('Error retrying AI verification:', error);
      alert('Failed to retry AI verification');
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-black text-lg font-black" style={{
        fontFamily: "'Orbitron', monospace",
        textTransform: 'uppercase'
      }}>
        <div className="w-8 h-8 border-2 border-black border-t-transparent animate-spin mx-auto mb-4" style={{
          borderRadius: 0
        }}></div>
        LOADING DASHBOARD...
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <h2 className="text-4xl font-black text-black mb-8 pixel-text-shadow" style={{
        fontFamily: "'Orbitron', monospace",
        textTransform: 'uppercase',
        letterSpacing: '2px'
      }}>◆ INFLUENCER DASHBOARD</h2>

      <div className="mb-12">
        <div className="text-center mb-8">
          <h3 className="text-2xl font-black text-black mb-2 flex items-center justify-center" style={{
            fontFamily: "'Orbitron', monospace",
            textTransform: 'uppercase'
          }}>
            <span className="mr-3">▲</span>
            PROFILE SETUP
          </h3>
          <p className="text-black font-bold" style={{
            fontFamily: "'Orbitron', monospace",
            textTransform: 'uppercase'
          }}>COMPLETE YOUR PROFILE TO START PARTICIPATING IN CAMPAIGNS</p>
        </div>

        <div className="bg-white p-6 pixel-border pixel-shadow" style={{
          clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))'
        }}>
          <form onSubmit={handleProfileSubmit} className="space-y-6">
            <div>
              <label htmlFor="youtubeChannelName" className="block mb-2 font-black text-black flex items-center" style={{
                fontFamily: "'Orbitron', monospace",
                textTransform: 'uppercase'
              }}>
                <span className="mr-2">►</span>
                YOUTUBE CHANNEL NAME
              </label>
              <input
                type="text"
                id="youtubeChannelName"
                value={profile.youtubeChannelName}
                onChange={(e) => setProfile({...profile, youtubeChannelName: e.target.value})}
                required
                placeholder="YOUR CHANNEL NAME"
                className="w-full p-4 border-3 border-black text-base transition-all focus:outline-none bg-white font-bold" style={{
                  fontFamily: "'Orbitron', monospace"
                }}
              />
            </div>

            <div>
              <label htmlFor="youtubeChannelId" className="block mb-2 font-black text-black flex items-center" style={{
                fontFamily: "'Orbitron', monospace",
                textTransform: 'uppercase'
              }}>
                <span className="mr-2">►</span>
                YOUTUBE CHANNEL ID
              </label>
              <input
                type="text"
                id="youtubeChannelId"
                value={profile.youtubeChannelId}
                onChange={(e) => setProfile({...profile, youtubeChannelId: e.target.value})}
                required
                placeholder="UCXXXXXXXXXXXXXXXXXXXXXXX"
                className="w-full p-4 border-3 border-black text-base transition-all focus:outline-none bg-white font-bold" style={{
                  fontFamily: "'Orbitron', monospace"
                }}
              />
              <div className="mt-2 p-3 bg-black text-white pixel-border">
                <div className="text-white text-sm font-bold flex items-center" style={{
                  fontFamily: "'Orbitron', monospace"
                }}>
                  <span className="mr-2">►</span>
                  FIND IN YOUTUBE STUDIO → SETTINGS → CHANNEL → ADVANCED SETTINGS
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block mb-2 font-black text-black flex items-center" style={{
                fontFamily: "'Orbitron', monospace",
                textTransform: 'uppercase'
              }}>
                <span className="mr-2">►</span>
                CONTACT EMAIL <span className="text-gray-600 text-sm ml-2 font-bold">(OPTIONAL)</span>
              </label>
              <input
                type="email"
                id="email"
                value={profile.email}
                onChange={(e) => setProfile({...profile, email: e.target.value})}
                placeholder="YOUR@EMAIL.COM"
                className="w-full p-4 border-3 border-black text-base transition-all focus:outline-none bg-white font-bold" style={{
                  fontFamily: "'Orbitron', monospace"
                }}
              />
            </div>

          {profile.youtubeChannelId && (
            <div className="mb-6">
              <label className="block mb-2 font-black text-black" style={{
                fontFamily: "'Orbitron', monospace",
                textTransform: 'uppercase'
              }}>CHANNEL VERIFICATION STATUS</label>
              <div className="mt-2">
                {profile.isChannelVerified ? (
                  <div className="text-black font-black flex items-center gap-2" style={{
                    fontFamily: "'Orbitron', monospace"
                  }}>
                    ▲ CHANNEL VERIFIED
                  </div>
                ) : (
                  <div className="text-black font-black flex items-center gap-2" style={{
                    fontFamily: "'Orbitron', monospace"
                  }}>
                    ▼ CHANNEL NOT VERIFIED
                    <button
                      type="button"
                      onClick={generateVerificationCode}
                      className="pixel-button py-2 px-4 text-sm font-black ml-2" style={{
                        fontFamily: "'Orbitron', monospace",
                        textTransform: 'uppercase'
                      }}
                    >
                      VERIFY CHANNEL
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {showVerification && !profile.isChannelVerified && (
            <div className="bg-black text-white p-6 mt-4 pixel-border">
              <h4 className="text-white font-black mb-4" style={{
                fontFamily: "'Orbitron', monospace",
                textTransform: 'uppercase'
              }}>CHANNEL VERIFICATION</h4>
              <p className="text-white mb-4 font-bold" style={{
                fontFamily: "'Orbitron', monospace"
              }}>TO VERIFY YOUR CHANNEL OWNERSHIP, ADD THIS CODE TO YOUR CHANNEL's LATEST VIDEO DESCRIPTION:</p>
              <div className="bg-white border-2 border-black p-4 my-4 text-lg text-center tracking-wide font-black text-black" style={{
                fontFamily: "'Orbitron', monospace"
              }}>
                {profile.verificationCode}
              </div>
              <p className="text-white mb-4 font-bold" style={{
                fontFamily: "'Orbitron', monospace"
              }}>AFTER ADDING THE CODE, CLICK "COMPLETE VERIFICATION" BELOW.</p>
              <button
                type="button"
                onClick={handleVerifyChannel}
                disabled={verifying}
                className="pixel-button py-3 px-6 font-black transition-all duration-100 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none" style={{
                  fontFamily: "'Orbitron', monospace",
                  textTransform: 'uppercase'
                }}
              >
                {verifying ? (
                  <span className="flex items-center">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent animate-spin mr-2" style={{
                      borderRadius: 0
                    }}></div>
                    VERIFYING...
                  </span>
                ) : (
                  'COMPLETE VERIFICATION'
                )}
              </button>
            </div>
          )}

            <div className="pt-4">
              <button type="submit" className="w-full pixel-button py-4 px-8 font-black text-base transition-all duration-100 flex items-center justify-center" style={{
                fontFamily: "'Orbitron', monospace",
                textTransform: 'uppercase'
              }}>
                <span className="mr-2">►</span>
                SAVE PROFILE
              </button>
            </div>
          </form>
        </div>
      </div>

      {registeredCampaigns.length > 0 && (
        <div className="mb-12">
          <div className="text-center mb-8">
            <h3 className="text-2xl font-black text-black mb-2 flex items-center justify-center" style={{
              fontFamily: "'Orbitron', monospace",
              textTransform: 'uppercase'
            }}>
              <span className="mr-3">▲</span>
              SUBMIT VIDEO
            </h3>
            <p className="text-black font-bold" style={{
              fontFamily: "'Orbitron', monospace",
              textTransform: 'uppercase'
            }}>SHARE YOUR CAMPAIGN VIDEO AND START EARNING REWARDS</p>
          </div>

          <div className="bg-white p-6 pixel-border pixel-shadow" style={{
            clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))'
          }}>
            <form onSubmit={handleSubmissionSubmit} className="space-y-6">
              <div>
                <label htmlFor="campaignSelect" className="block mb-2 font-black text-black flex items-center" style={{
                  fontFamily: "'Orbitron', monospace",
                  textTransform: 'uppercase'
                }}>
                  <span className="mr-2">►</span>
                  SELECT CAMPAIGN
                </label>
                <select
                  id="campaignSelect"
                  value={submissionForm.campaignId}
                  onChange={(e) => setSubmissionForm({...submissionForm, campaignId: e.target.value})}
                  required
                  className="w-full p-4 border-3 border-black text-base transition-all focus:outline-none bg-white font-bold" style={{
                    fontFamily: "'Orbitron', monospace"
                  }}
                >
                  <option value="">CHOOSE A CAMPAIGN...</option>
                  {registeredCampaigns.map((campaign) => {
                    const hasSubmitted = submissions.some(sub => sub.campaignId == campaign.id);
                    return (
                      <option
                        key={campaign.id}
                        value={campaign.id}
                        disabled={hasSubmitted}
                        style={hasSubmitted ? { backgroundColor: '#f0f0f0', color: '#666' } : {}}
                      >
                        {hasSubmitted ? '✓ SUBMITTED: ' : ''}{(campaign.title || `CAMPAIGN #${campaign.id}`).toUpperCase()} - {campaign.totalReward} FLOW
                      </option>
                    );
                  })}
                </select>
                {registeredCampaigns.some(campaign => submissions.some(sub => sub.campaignId == campaign.id)) && (
                  <div className="mt-2 text-black text-sm font-bold" style={{
                    fontFamily: "'Orbitron', monospace"
                  }}>
                    ℹ️ Campaigns marked "✓ SUBMITTED" are disabled - only one submission per campaign allowed.
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="youtubeUrl" className="block mb-2 font-black text-black flex items-center" style={{
                  fontFamily: "'Orbitron', monospace",
                  textTransform: 'uppercase'
                }}>
                  <span className="mr-2">►</span>
                  YOUTUBE VIDEO URL
                </label>
                <input
                  type="url"
                  id="youtubeUrl"
                  value={submissionForm.youtubeUrl}
                  onChange={(e) => setSubmissionForm({...submissionForm, youtubeUrl: e.target.value})}
                  required
                  placeholder="HTTPS://WWW.YOUTUBE.COM/WATCH?V=..."
                  className="w-full p-4 border-3 border-black text-base transition-all focus:outline-none bg-white font-bold" style={{
                    fontFamily: "'Orbitron', monospace"
                  }}
                />
              </div>

              {/* Video Verification Section */}
              {submissionForm.youtubeUrl && (
                <div className="bg-black text-white p-4 pixel-border">
                  <h4 className="text-white font-black mb-3" style={{
                    fontFamily: "'Orbitron', monospace",
                    textTransform: 'uppercase'
                  }}>🔒 VIDEO OWNERSHIP VERIFICATION</h4>
                  <p className="text-white mb-3 font-bold text-sm" style={{
                    fontFamily: "'Orbitron', monospace"
                  }}>To ensure authenticity, we'll verify this video belongs to your registered YouTube channel.</p>
                  <button
                    type="button"
                    onClick={() => verifyVideoOwnership(submissionForm.youtubeUrl)}
                    disabled={verifyingVideo || !submissionForm.youtubeUrl}
                    className="pixel-button py-2 px-4 text-sm font-black transition-all duration-100 disabled:opacity-60 disabled:cursor-not-allowed mr-3" style={{
                      fontFamily: "'Orbitron', monospace",
                      textTransform: 'uppercase'
                    }}
                  >
                    {verifyingVideo ? (
                      <span className="flex items-center">
                        <div className="w-4 h-4 border-2 border-current border-t-transparent animate-spin mr-2" style={{
                          borderRadius: 0
                        }}></div>
                        VERIFYING...
                      </span>
                    ) : (
                      '🔍 VERIFY VIDEO'
                    )}
                  </button>
                  <div className="mt-2 text-yellow-400 text-xs font-bold" style={{
                    fontFamily: "'Orbitron', monospace"
                  }}>
                    ⚠️ Verification happens automatically when you submit, but you can check beforehand.
                  </div>
                </div>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full pixel-button py-4 px-8 font-black text-base transition-all duration-100 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center" style={{
                    fontFamily: "'Orbitron', monospace",
                    textTransform: 'uppercase'
                  }}
                >
                  {submitting ? (
                    <span className="flex items-center">
                      <div className="w-5 h-5 border-2 border-current border-t-transparent animate-spin mr-2" style={{
                        borderRadius: 0
                      }}></div>
                      SUBMITTING...
                    </span>
                  ) : (
                    <span className="flex items-center">
                      <span className="mr-2">►</span>
                      SUBMIT VIDEO
                    </span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="mb-12">
        <h3 className="text-black text-xl font-black mb-6 pb-2 border-b-2 border-black" style={{
          fontFamily: "'Orbitron', monospace",
          textTransform: 'uppercase'
        }}>◆ MY REGISTERED CAMPAIGNS</h3>
        {registeredCampaigns.length === 0 ? (
          <p className="text-center py-12 text-black font-bold" style={{
            fontFamily: "'Orbitron', monospace",
            textTransform: 'uppercase'
          }}>YOU HAVEN'T REGISTERED FOR ANY CAMPAIGNS YET. BROWSE CAMPAIGNS TO GET STARTED!</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {registeredCampaigns.map((campaign) => (
              <div key={campaign.id} className="bg-white overflow-hidden pixel-border pixel-shadow transition-all duration-100 hover:-translate-y-1" style={{
                clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))'
              }}>
                <div className="p-6">
                  <h4 className="text-lg font-black text-black mb-2" style={{
                    fontFamily: "'Orbitron', monospace",
                    textTransform: 'uppercase'
                  }}>{campaign.title || `CAMPAIGN #${campaign.id}`}</h4>
                  <p className="text-black mb-4 overflow-hidden line-clamp-2 font-bold" style={{
                    fontFamily: "'Orbitron', monospace"
                  }}>{campaign.description}</p>
                  <div className="grid grid-cols-2 gap-4 mb-4 text-black">
                    <div className="text-center p-3 bg-black text-white pixel-border">
                      <div className="block text-lg text-white font-black" style={{
                        fontFamily: "'Orbitron', monospace"
                      }}>{campaign.totalReward} FLOW</div>
                      <div className="text-sm text-white font-bold" style={{
                        fontFamily: "'Orbitron', monospace"
                      }}>REWARD</div>
                    </div>
                    <div className="text-center p-3 bg-black text-white pixel-border">
                      <div className="block text-lg text-white font-black" style={{
                        fontFamily: "'Orbitron', monospace"
                      }}>{campaign.influencerCount}</div>
                      <div className="text-sm text-white font-bold" style={{
                        fontFamily: "'Orbitron', monospace"
                      }}>PARTICIPANTS</div>
                    </div>
                  </div>
                  <div className="text-sm text-black mb-4 font-bold" style={{
                    fontFamily: "'Orbitron', monospace"
                  }}>
                    <p className="mb-1"><span className="font-black">► REGISTRATION ENDS:</span> {formatDate(campaign.registrationEnd)}</p>
                    <p><span className="font-black">► CAMPAIGN ENDS:</span> {formatDate(campaign.campaignEnd)}</p>
                  </div>
                  <div className="bg-black text-white p-4 pixel-border border-l-4 border-white">
                    <strong className="text-white font-black" style={{
                      fontFamily: "'Orbitron', monospace",
                      textTransform: 'uppercase'
                    }}>REQUIREMENTS:</strong>
                    <p className="mt-2 font-bold" style={{
                      fontFamily: "'Orbitron', monospace"
                    }}>{campaign.requirements}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {submissions.length > 0 && (
        <div className="mb-12">
          <h3 className="text-black text-xl font-black mb-6 pb-2 border-b-2 border-black" style={{
            fontFamily: "'Orbitron', monospace",
            textTransform: 'uppercase'
          }}>◆ MY SUBMISSIONS</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {submissions.map((submission) => (
              <div key={submission.id} className="bg-white overflow-hidden pixel-border pixel-shadow transition-all duration-100 hover:-translate-y-1" style={{
                clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))'
              }}>
                <a
                  href={submission.youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <div className="relative w-full h-40 bg-gray-50 overflow-hidden">
                    {submission.youtubeVideoId ? (
                      <img
                        src={`https://img.youtube.com/vi/${submission.youtubeVideoId}/mqdefault.jpg`}
                        alt="Video thumbnail"
                        onError={(e) => { e.target.style.display = 'none'; }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-white flex items-center justify-center text-black text-sm border-2 border-black font-bold" style={{
                        fontFamily: "'Orbitron', monospace"
                      }}>NO VIDEO</div>
                    )}
                  </div>
                </a>
                <div className="p-4">
                  <h4 className="text-black font-black text-base mb-2" style={{
                    fontFamily: "'Orbitron', monospace",
                    textTransform: 'uppercase'
                  }}>{submission.campaign_title}</h4>
                  <div className="flex justify-between text-sm text-black mb-3 font-bold" style={{
                    fontFamily: "'Orbitron', monospace"
                  }}>
                    <span>► {(submission.viewCount || 0).toLocaleString()}</span>
                    <span>▲ {(submission.likeCount || 0).toLocaleString()}</span>
                    <span>◆ {(submission.commentCount || 0).toLocaleString()}</span>
                  </div>
                  <p className="text-black font-black mb-2" style={{
                    fontFamily: "'Orbitron', monospace",
                    textTransform: 'uppercase'
                  }}>PERFORMANCE SCORE: {Math.round(submission.performanceScore || 0).toLocaleString()}</p>

                  {/* AI Verification Status */}
                  {submission.aiVerification && (
                    <div
                      className={`p-2 mb-2 pixel-border cursor-pointer hover:opacity-80 transition-opacity ${
                        submission.aiVerification.status === 'approved' ? 'bg-green-100 border-green-600' :
                        submission.aiVerification.status === 'rejected' ? 'bg-red-100 border-red-600' :
                        submission.aiVerification.status === 'error' ? 'bg-yellow-100 border-yellow-600' :
                        'bg-gray-100 border-gray-600'
                      }`}
                      onClick={() => fetchAIVerificationDetails(submission.id)}
                    >
                      <div className="text-xs font-black" style={{
                        fontFamily: "'Orbitron', monospace",
                        textTransform: 'uppercase'
                      }}>
                        🤖 AI VERIFICATION: {
                          submission.aiVerification.status === 'approved' ? '✅ APPROVED' :
                          submission.aiVerification.status === 'rejected' ? '❌ REJECTED' :
                          submission.aiVerification.status === 'error' ? '⚠️ ERROR' :
                          '⏳ PENDING'
                        }
                      </div>
                      {submission.aiVerification.confidence && (
                        <div className="text-xs font-bold mt-1" style={{
                          fontFamily: "'Orbitron', monospace"
                        }}>
                          CONFIDENCE: {submission.aiVerification.confidence}%
                        </div>
                      )}
                      {submission.aiVerification.brandMentions && submission.aiVerification.brandMentions.length > 0 && (
                        <div className="text-xs font-bold mt-1" style={{
                          fontFamily: "'Orbitron', monospace"
                        }}>
                          BRANDS: {submission.aiVerification.brandMentions.slice(0, 2).join(', ')}
                          {submission.aiVerification.brandMentions.length > 2 ? '...' : ''}
                        </div>
                      )}
                      <div className="text-xs font-bold mt-1 text-blue-600" style={{
                        fontFamily: "'Orbitron', monospace"
                      }}>
                        🔍 CLICK FOR DETAILS
                      </div>
                    </div>
                  )}

                  <p className="text-black text-xs font-bold" style={{
                    fontFamily: "'Orbitron', monospace",
                    textTransform: 'uppercase'
                  }}>SUBMITTED: {formatDate(submission.createdAt ? new Date(submission.createdAt).getTime() : Date.now())}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Verification Details Modal */}
      {showAIDetails && aiDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white max-w-2xl w-full max-h-[90vh] overflow-y-auto pixel-border pixel-shadow" style={{
            clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))'
          }}>
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-black" style={{
                  fontFamily: "'Orbitron', monospace",
                  textTransform: 'uppercase'
                }}>🤖 AI VERIFICATION DETAILS</h3>
                <button
                  onClick={() => setShowAIDetails(null)}
                  className="pixel-button px-4 py-2 text-sm font-black"
                >
                  ✕ CLOSE
                </button>
              </div>

              <div className="space-y-4">
                {/* Status Overview */}
                <div className={`p-4 pixel-border ${
                  aiDetails.aiVerification?.approved ? 'bg-green-50 border-green-600' : 'bg-red-50 border-red-600'
                }`}>
                  <h4 className="font-black text-lg mb-2" style={{
                    fontFamily: "'Orbitron', monospace",
                    textTransform: 'uppercase'
                  }}>
                    STATUS: {aiDetails.aiVerification?.approved ? '✅ APPROVED' : '❌ REJECTED'}
                  </h4>
                  {aiDetails.aiVerification?.confidence && (
                    <p className="font-bold" style={{ fontFamily: "'Orbitron', monospace" }}>
                      CONFIDENCE: {aiDetails.aiVerification.confidence}%
                    </p>
                  )}
                </div>

                {/* Reason */}
                {aiDetails.aiVerification?.reason && (
                  <div className="bg-gray-50 p-4 pixel-border">
                    <h4 className="font-black mb-2" style={{
                      fontFamily: "'Orbitron', monospace",
                      textTransform: 'uppercase'
                    }}>AI ANALYSIS REASON:</h4>
                    <p className="font-bold" style={{ fontFamily: "'Orbitron', monospace" }}>
                      {aiDetails.aiVerification.reason}
                    </p>
                  </div>
                )}

                {/* Brand Mentions */}
                {aiDetails.aiVerification?.brandMentions && aiDetails.aiVerification.brandMentions.length > 0 && (
                  <div className="bg-blue-50 p-4 pixel-border">
                    <h4 className="font-black mb-2" style={{
                      fontFamily: "'Orbitron', monospace",
                      textTransform: 'uppercase'
                    }}>DETECTED BRAND MENTIONS:</h4>
                    <div className="flex flex-wrap gap-2">
                      {aiDetails.aiVerification.brandMentions.map((brand, index) => (
                        <span
                          key={index}
                          className="bg-blue-600 text-white px-2 py-1 text-sm font-bold pixel-border"
                          style={{ fontFamily: "'Orbitron', monospace" }}
                        >
                          {brand}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Requirements Check */}
                {aiDetails.aiVerification?.meetsRequirements && (
                  <div className="bg-yellow-50 p-4 pixel-border">
                    <h4 className="font-black mb-2" style={{
                      fontFamily: "'Orbitron', monospace",
                      textTransform: 'uppercase'
                    }}>REQUIREMENTS CHECK:</h4>
                    <div className="space-y-2">
                      <div className="flex items-center" style={{ fontFamily: "'Orbitron', monospace" }}>
                        <span className={`mr-2 ${aiDetails.aiVerification.meetsRequirements.mentionsBrand ? 'text-green-600' : 'text-red-600'}`}>
                          {aiDetails.aiVerification.meetsRequirements.mentionsBrand ? '✅' : '❌'}
                        </span>
                        <span className="font-bold">MENTIONS BRAND</span>
                      </div>
                      <div className="flex items-center" style={{ fontFamily: "'Orbitron', monospace" }}>
                        <span className={`mr-2 ${aiDetails.aiVerification.meetsRequirements.followsGuidelines ? 'text-green-600' : 'text-red-600'}`}>
                          {aiDetails.aiVerification.meetsRequirements.followsGuidelines ? '✅' : '❌'}
                        </span>
                        <span className="font-bold">FOLLOWS GUIDELINES</span>
                      </div>
                      <div className="flex items-center" style={{ fontFamily: "'Orbitron', monospace" }}>
                        <span className={`mr-2 ${aiDetails.aiVerification.meetsRequirements.adequateWordCount ? 'text-green-600' : 'text-red-600'}`}>
                          {aiDetails.aiVerification.meetsRequirements.adequateWordCount ? '✅' : '❌'}
                        </span>
                        <span className="font-bold">ADEQUATE WORD COUNT</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Technical Details */}
                <div className="bg-gray-50 p-4 pixel-border">
                  <h4 className="font-black mb-2" style={{
                    fontFamily: "'Orbitron', monospace",
                    textTransform: 'uppercase'
                  }}>TECHNICAL DETAILS:</h4>
                  <div className="space-y-1 text-sm">
                    {aiDetails.aiVerification?.promotionalSegmentWordCount && (
                      <p className="font-bold" style={{ fontFamily: "'Orbitron', monospace" }}>
                        PROMOTIONAL SEGMENT: {aiDetails.aiVerification.promotionalSegmentWordCount} WORDS
                      </p>
                    )}
                    {aiDetails.aiVerification?.transcriptLanguage && (
                      <p className="font-bold" style={{ fontFamily: "'Orbitron', monospace" }}>
                        TRANSCRIPT LANGUAGE: {aiDetails.aiVerification.transcriptLanguage.toUpperCase()}
                      </p>
                    )}
                    {aiDetails.aiVerification?.transcriptLength && (
                      <p className="font-bold" style={{ fontFamily: "'Orbitron', monospace" }}>
                        TRANSCRIPT LENGTH: {aiDetails.aiVerification.transcriptLength} CHARACTERS
                      </p>
                    )}
                    {aiDetails.aiVerification?.processingTime && (
                      <p className="font-bold" style={{ fontFamily: "'Orbitron', monospace" }}>
                        PROCESSING TIME: {aiDetails.aiVerification.processingTime}MS
                      </p>
                    )}
                    {aiDetails.aiVerification?.verifiedAt && (
                      <p className="font-bold" style={{ fontFamily: "'Orbitron', monospace" }}>
                        VERIFIED: {formatDate(new Date(aiDetails.aiVerification.verifiedAt).getTime())}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {(aiDetails.aiVerification?.status === 'error' || aiDetails.aiVerification?.status === 'rejected') && (
                  <div className="flex gap-4">
                    <button
                      onClick={() => {
                        retryAIVerification(showAIDetails);
                        setShowAIDetails(null);
                      }}
                      className="pixel-button px-4 py-2 font-black"
                      style={{
                        fontFamily: "'Orbitron', monospace",
                        textTransform: 'uppercase'
                      }}
                    >
                      🔄 RETRY VERIFICATION
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay for AI details */}
      {loadingAIDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 pixel-border pixel-shadow">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-black border-t-transparent animate-spin mx-auto mb-4" style={{
                borderRadius: 0
              }}></div>
              <p className="font-black" style={{
                fontFamily: "'Orbitron', monospace",
                textTransform: 'uppercase'
              }}>LOADING AI DETAILS...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InfluencerDashboard;