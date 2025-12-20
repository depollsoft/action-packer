/**
 * Onboarding Wizard Component
 * Guides users through GitHub App setup and installation
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { onboardingApi } from '../api';
import type {
  SetupStatus,
  GitHubAppInfo,
  GitHubAppManifestResponse,
} from '../types';

type OnboardingStep = 'welcome' | 'base-url' | 'create-app' | 'install-app' | 'complete';

// Icons
const CheckIcon = () => (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M5 13l4 4L19 7"
    />
  </svg>
);

const SpinnerIcon = () => (
  <svg
    className="w-5 h-5 animate-spin"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

const GitHubIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

const ArrowLeftIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

export function OnboardingWizard({ onComplete }: { onComplete?: () => void }) {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [baseUrl, setBaseUrl] = useState('');
  const [appName, setAppName] = useState('Action Packer');
  const [orgName, setOrgName] = useState('');
  const [isOrgApp, setIsOrgApp] = useState(false);
  const [setupMethod, setSetupMethod] = useState<'automatic' | 'manual'>('automatic');
  const [error, setError] = useState<string | null>(null);
  
  // Manual setup form state
  const [manualAppId, setManualAppId] = useState('');
  const [manualClientId, setManualClientId] = useState('');
  const [manualClientSecret, setManualClientSecret] = useState('');
  const [manualPrivateKey, setManualPrivateKey] = useState('');
  const [manualWebhookSecret, setManualWebhookSecret] = useState('');
  
  // Form for creating app via manifest
  const formRef = useRef<HTMLFormElement>(null);

  // Fetch setup status
  const { data: status, refetch: refetchStatus } = useQuery<SetupStatus>({
    queryKey: ['setup-status'],
    queryFn: () => onboardingApi.getStatus(),
  });

  // Fetch GitHub App info if configured
  const { data: appInfo } = useQuery<GitHubAppInfo>({
    queryKey: ['github-app'],
    queryFn: () => onboardingApi.getGitHubApp(),
    enabled: status?.steps.githubApp.complete ?? false,
    retry: false,
  });

  // Fetch installations
  const { data: installationsData, refetch: refetchInstallations } = useQuery({
    queryKey: ['installations'],
    queryFn: () => onboardingApi.getInstallations(true),
    enabled: status?.steps.githubApp.complete ?? false,
  });

  // Fetch manifest for automatic setup
  const { data: manifestData } = useQuery<GitHubAppManifestResponse>({
    queryKey: ['manifest', appName, orgName, isOrgApp],
    queryFn: () =>
      onboardingApi.getManifest({
        name: appName,
        org: isOrgApp ? orgName : undefined,
      }),
    enabled: currentStep === 'create-app' && setupMethod === 'automatic',
  });

  // Base URL mutation
  const setBaseUrlMutation = useMutation({
    mutationFn: (url: string) => onboardingApi.setBaseUrl(url),
    onSuccess: () => {
      setCurrentStep('create-app');
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Manual setup mutation
  const manualSetupMutation = useMutation({
    mutationFn: () =>
      onboardingApi.setupGitHubAppManual({
        appId: parseInt(manualAppId, 10),
        clientId: manualClientId,
        clientSecret: manualClientSecret,
        privateKey: manualPrivateKey,
        webhookSecret: manualWebhookSecret || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup-status'] });
      queryClient.invalidateQueries({ queryKey: ['github-app'] });
      setCurrentStep('install-app');
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Get install URL
  const { data: installUrlData } = useQuery({
    queryKey: ['install-url'],
    queryFn: () => onboardingApi.getInstallUrl(),
    enabled: currentStep === 'install-app' && status?.steps.githubApp.complete,
  });

  // Detect base URL on mount
  useEffect(() => {
    if (!baseUrl) {
      setBaseUrl(window.location.origin);
    }
  }, [baseUrl]);

  // Check if setup is complete and skip to dashboard
  useEffect(() => {
    if (status?.isComplete) {
      setCurrentStep('complete');
    } else if (status?.steps.githubApp.complete) {
      setCurrentStep('install-app');
    }
  }, [status]);

  // Handle automatic app creation
  const handleCreateAppAutomatic = () => {
    if (manifestData && formRef.current) {
      const input = formRef.current.querySelector(
        'input[name="manifest"]'
      ) as HTMLInputElement;
      if (input) {
        input.value = manifestData.manifestJson;
        formRef.current.submit();
      }
    }
  };

  // Handle manual setup
  const handleCreateAppManual = () => {
    if (!manualAppId || !manualClientId || !manualClientSecret || !manualPrivateKey) {
      setError('Please fill in all required fields');
      return;
    }
    manualSetupMutation.mutate();
  };

  // Render step indicator
  const renderStepIndicator = () => {
    const steps = [
      { id: 'welcome', label: 'Welcome' },
      { id: 'base-url', label: 'Configure URL' },
      { id: 'create-app', label: 'Create App' },
      { id: 'install-app', label: 'Install App' },
      { id: 'complete', label: 'Complete' },
    ];

    const currentIndex = steps.findIndex((s) => s.id === currentStep);

    return (
      <div className="flex items-center justify-center mb-8">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center">
            <div
              className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                ${
                  index < currentIndex
                    ? 'bg-emerald-500 text-white'
                    : index === currentIndex
                    ? 'bg-emerald-600 text-white'
                    : 'bg-forest-700 text-muted'
                }
              `}
            >
              {index < currentIndex ? <CheckIcon /> : index + 1}
            </div>
            {index < steps.length - 1 && (
              <div
                className={`w-12 h-0.5 mx-1 ${
                  index < currentIndex ? 'bg-emerald-500' : 'bg-forest-700'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  // Render welcome step
  const renderWelcomeStep = () => (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500/20 rounded-full mb-6">
        <GitHubIcon />
      </div>
      <h2 className="text-2xl font-bold mb-4">Welcome to Action Packer</h2>
      <p className="text-muted mb-6 max-w-md mx-auto">
        Action Packer helps you manage self-hosted GitHub Actions runners. To get started,
        we'll set up a GitHub App that allows Action Packer to manage runners for your
        repositories and organizations.
      </p>
      <div className="space-y-3 text-left max-w-md mx-auto mb-8">
        <div className="flex items-start gap-3 p-3 bg-forest-800 rounded-lg">
          <CheckIcon />
          <div>
            <div className="font-medium">Automatic Runner Registration</div>
            <div className="text-sm text-muted">
              Register and configure runners without manual token management
            </div>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 bg-forest-800 rounded-lg">
          <CheckIcon />
          <div>
            <div className="font-medium">Webhook Integration</div>
            <div className="text-sm text-muted">
              Automatically scale runners based on workflow demands
            </div>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 bg-forest-800 rounded-lg">
          <CheckIcon />
          <div>
            <div className="font-medium">Secure Access</div>
            <div className="text-sm text-muted">
              Fine-grained permissions for runner management only
            </div>
          </div>
        </div>
      </div>
      <button
        onClick={() => setCurrentStep('base-url')}
        className="inline-flex items-center gap-2 px-8 py-3 rounded-lg text-lg font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-all duration-200 shadow-lg shadow-emerald-900/30"
      >
        Get Started
        <ArrowRightIcon />
      </button>
    </div>
  );

  // Render base URL step
  const renderBaseUrlStep = () => (
    <div className="max-w-lg mx-auto">
      <h2 className="text-2xl font-bold mb-4 text-center">Configure Server URL</h2>
      <p className="text-muted mb-6 text-center">
        Enter the public URL where Action Packer is hosted. This will be used for GitHub
        webhooks and OAuth callbacks.
      </p>
      
      <div className="space-y-4">
        <div>
          <label htmlFor="baseUrl" className="label">
            Server URL
          </label>
          <input
            id="baseUrl"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-action-packer.example.com"
            className="input"
          />
          <p className="text-xs text-muted mt-1">
            Must be accessible from the internet for webhooks to work
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-4 justify-center pt-6">
          <button
            onClick={() => setCurrentStep('welcome')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-forest-200 bg-forest-800 border border-forest-600 hover:bg-forest-700 hover:border-forest-500 transition-all duration-200"
          >
            <ArrowLeftIcon />
            Back
          </button>
          <button
            onClick={() => setBaseUrlMutation.mutate(baseUrl)}
            disabled={!baseUrl || setBaseUrlMutation.isPending}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-emerald-900/30"
          >
            {setBaseUrlMutation.isPending ? (
              <>
                <SpinnerIcon />
                Saving...
              </>
            ) : (
              <>
                Continue
                <ArrowRightIcon />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // Render create app step
  const renderCreateAppStep = () => (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4 text-center">Create GitHub App</h2>
      <p className="text-muted mb-6 text-center">
        Choose how you want to set up your GitHub App.
      </p>

      {/* Setup method tabs */}
      <div className="flex gap-2 mb-6 justify-center">
        <button
          onClick={() => setSetupMethod('automatic')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            setupMethod === 'automatic'
              ? 'bg-emerald-600 text-white'
              : 'bg-forest-800 text-muted hover:bg-forest-700'
          }`}
        >
          Automatic Setup
        </button>
        <button
          onClick={() => setSetupMethod('manual')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            setupMethod === 'manual'
              ? 'bg-emerald-600 text-white'
              : 'bg-forest-800 text-muted hover:bg-forest-700'
          }`}
        >
          Use Existing App
        </button>
      </div>

      {setupMethod === 'automatic' ? (
        <div className="space-y-4">
          <div className="p-4 bg-forest-800 rounded-lg">
            <h3 className="font-medium mb-3">App Configuration</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="appName" className="label">
                  App Name
                </label>
                <input
                  id="appName"
                  type="text"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="Action Packer"
                  className="input"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isOrgApp"
                  checked={isOrgApp}
                  onChange={(e) => setIsOrgApp(e.target.checked)}
                  className="w-4 h-4 rounded border-forest-600 bg-forest-700 text-emerald-500 focus:ring-emerald-500"
                />
                <label htmlFor="isOrgApp" className="text-sm">
                  Create for an organization
                </label>
              </div>

              {isOrgApp && (
                <div>
                  <label htmlFor="orgName" className="label">
                    Organization Name
                  </label>
                  <input
                    id="orgName"
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="your-org"
                    className="input"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <h4 className="font-medium text-blue-400 mb-2">How it works</h4>
            <ol className="text-sm text-muted space-y-1 list-decimal list-inside">
              <li>Click "Create on GitHub" to be redirected to GitHub</li>
              <li>Review the app permissions and click "Create GitHub App"</li>
              <li>You'll be redirected back here automatically</li>
            </ol>
          </div>

          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form
            ref={formRef}
            action={manifestData?.githubUrl}
            method="post"
            className="flex gap-4 justify-center pt-4"
          >
            <input type="hidden" name="manifest" />
            <button
              type="button"
              onClick={() => setCurrentStep('base-url')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-forest-200 bg-forest-800 border border-forest-600 hover:bg-forest-700 hover:border-forest-500 transition-all duration-200"
            >
              <ArrowLeftIcon />
              Back
            </button>
            <button
              type="button"
              onClick={handleCreateAppAutomatic}
              disabled={!manifestData}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-emerald-900/30"
            >
              <GitHubIcon />
              Create on GitHub
            </button>
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-forest-800 rounded-lg">
            <h3 className="font-medium mb-3">Existing App Credentials</h3>
            <p className="text-sm text-muted mb-4">
              Enter the credentials from your existing GitHub App. You can find these in
              your app's settings page.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="manualAppId" className="label">
                    App ID *
                  </label>
                  <input
                    id="manualAppId"
                    type="text"
                    value={manualAppId}
                    onChange={(e) => setManualAppId(e.target.value)}
                    placeholder="123456"
                    className="input"
                  />
                </div>
                <div>
                  <label htmlFor="manualClientId" className="label">
                    Client ID *
                  </label>
                  <input
                    id="manualClientId"
                    type="text"
                    value={manualClientId}
                    onChange={(e) => setManualClientId(e.target.value)}
                    placeholder="Iv1.xxxxxxxx"
                    className="input"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="manualClientSecret" className="label">
                  Client Secret *
                </label>
                <input
                  id="manualClientSecret"
                  type="password"
                  value={manualClientSecret}
                  onChange={(e) => setManualClientSecret(e.target.value)}
                  placeholder="••••••••"
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="manualPrivateKey" className="label">
                  Private Key (PEM) *
                </label>
                <textarea
                  id="manualPrivateKey"
                  value={manualPrivateKey}
                  onChange={(e) => setManualPrivateKey(e.target.value)}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
                  rows={4}
                  className="input font-mono text-xs"
                />
              </div>
              <div>
                <label htmlFor="manualWebhookSecret" className="label">
                  Webhook Secret (optional)
                </label>
                <input
                  id="manualWebhookSecret"
                  type="password"
                  value={manualWebhookSecret}
                  onChange={(e) => setManualWebhookSecret(e.target.value)}
                  placeholder="••••••••"
                  className="input"
                />
              </div>
            </div>
          </div>

          <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <h4 className="font-medium text-yellow-400 mb-2">Required Permissions</h4>
            <p className="text-sm text-muted">
              Your GitHub App must have the following permissions:
            </p>
            <ul className="text-sm text-muted mt-2 space-y-1 list-disc list-inside">
              <li>Repository administration: Write</li>
              <li>Repository metadata: Read</li>
              <li>Actions: Read</li>
              <li>Organization self-hosted runners: Write (for org-level runners)</li>
            </ul>
          </div>

          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-4 justify-center pt-4">
            <button
              type="button"
              onClick={() => setCurrentStep('base-url')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-forest-200 bg-forest-800 border border-forest-600 hover:bg-forest-700 hover:border-forest-500 transition-all duration-200"
            >
              <ArrowLeftIcon />
              Back
            </button>
            <button
              type="button"
              onClick={handleCreateAppManual}
              disabled={manualSetupMutation.isPending}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-emerald-900/30"
            >
              {manualSetupMutation.isPending ? (
                <>
                  <SpinnerIcon />
                  Validating...
                </>
              ) : (
                <>
                  <CheckIcon />
                  Validate & Save
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Render install app step
  const renderInstallAppStep = () => {
    const installations = installationsData?.installations || [];

    return (
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 text-center">Install GitHub App</h2>
        <p className="text-muted mb-6 text-center">
          Install your GitHub App on the repositories or organizations where you want to
          manage runners.
        </p>

        {appInfo && (
          <div className="p-4 bg-forest-800 rounded-lg mb-6">
            <div className="flex items-center gap-3 mb-3">
              <GitHubIcon />
              <div>
                <div className="font-medium">{appInfo.name}</div>
                <div className="text-sm text-muted">App ID: {appInfo.appId}</div>
              </div>
            </div>
            {installUrlData && (
              <a
                href={installUrlData.installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-all duration-200 shadow-lg shadow-emerald-900/30"
              >
                <GitHubIcon />
                Install App on GitHub
              </a>
            )}
          </div>
        )}

        <div className="p-4 bg-forest-800 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Installations ({installations.length})</h3>
            <button
              onClick={() => refetchInstallations()}
              className="text-sm text-emerald-400 hover:text-emerald-300"
            >
              Refresh
            </button>
          </div>

          {installations.length === 0 ? (
            <div className="text-center py-8 text-muted">
              <p>No installations yet.</p>
              <p className="text-sm mt-1">
                Install the app on GitHub to see it here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {installations.map((installation) => (
                <div
                  key={installation.id}
                  className="flex items-center justify-between p-3 bg-forest-900 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-forest-700 rounded-full flex items-center justify-center text-xs">
                      {installation.targetType === 'Organization' ? '🏢' : '👤'}
                    </div>
                    <div>
                      <div className="font-medium">{installation.account.login}</div>
                      <div className="text-xs text-muted">
                        {installation.repositorySelection === 'all'
                          ? 'All repositories'
                          : 'Selected repositories'}
                      </div>
                    </div>
                  </div>
                  {installation.suspendedAt && (
                    <span className="text-xs text-yellow-400">Suspended</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-4 justify-center pt-6">
          {installations.length > 0 ? (
            <button
              onClick={() => {
                setCurrentStep('complete');
                refetchStatus();
              }}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-all duration-200 shadow-lg shadow-emerald-900/30"
            >
              Continue to Dashboard
              <ArrowRightIcon />
            </button>
          ) : (
            <p className="text-sm text-muted">
              Install the app on at least one repository or organization to continue.
            </p>
          )}
        </div>
      </div>
    );
  };

  // Render complete step
  const renderCompleteStep = () => (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500/20 rounded-full mb-6">
        <CheckIcon />
      </div>
      <h2 className="text-2xl font-bold mb-4">Setup Complete!</h2>
      <p className="text-muted mb-6 max-w-md mx-auto">
        Action Packer is now configured and ready to manage your GitHub Actions runners.
      </p>
      <button
        onClick={onComplete}
        className="inline-flex items-center gap-2 px-8 py-3 rounded-lg text-lg font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-all duration-200 shadow-lg shadow-emerald-900/30"
      >
        Go to Dashboard
        <ArrowRightIcon />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-forest-900 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-emerald-400">⚡ Action Packer</h1>
        </div>

        {renderStepIndicator()}

        <div className="card p-8">
          {currentStep === 'welcome' && renderWelcomeStep()}
          {currentStep === 'base-url' && renderBaseUrlStep()}
          {currentStep === 'create-app' && renderCreateAppStep()}
          {currentStep === 'install-app' && renderInstallAppStep()}
          {currentStep === 'complete' && renderCompleteStep()}
        </div>
      </div>
    </div>
  );
}

export default OnboardingWizard;
