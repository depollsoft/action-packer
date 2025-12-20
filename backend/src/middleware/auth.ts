import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';

/**
 * Extended request interface with authenticated user info
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    sessionId: string;
  };
}

/**
 * Get a setting value from the database
 */
function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Check if the app has completed onboarding
 */
export function isSetupComplete(): boolean {
  return getSetting('setup_complete') === 'true';
}

/**
 * Get the admin user ID (the user who completed onboarding)
 */
export function getAdminUserId(): number | null {
  const value = getSetting('admin_user_id');
  return value ? parseInt(value, 10) : null;
}

/**
 * Validate a session and return session data if valid
 */
function validateSession(sessionId: string): {
  userId: number;
  userLogin: string;
  userName: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
} | null {
  const session = db.prepare(`
    SELECT user_id, user_login, user_name, user_email, user_avatar_url, expires_at
    FROM sessions
    WHERE id = ?
  `).get(sessionId) as {
    user_id: number;
    user_login: string;
    user_name: string | null;
    user_email: string | null;
    user_avatar_url: string | null;
    expires_at: string;
  } | undefined;

  if (!session) {
    return null;
  }

  // Check if session is expired
  if (new Date(session.expires_at) < new Date()) {
    // Clean up expired session
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }

  return {
    userId: session.user_id,
    userLogin: session.user_login,
    userName: session.user_name,
    userEmail: session.user_email,
    userAvatarUrl: session.user_avatar_url,
  };
}

/**
 * Middleware that requires authentication
 * 
 * This checks that:
 * 1. A valid session cookie exists
 * 2. The session is not expired
 * 3. The user is the admin (the one who completed onboarding)
 * 
 * Populates req.user with the authenticated user's info
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Check if setup is complete - if not, no auth is needed (still onboarding)
  if (!isSetupComplete()) {
    return next();
  }

  // Get session ID from cookie
  const sessionId = req.cookies?.session;
  
  if (!sessionId) {
    res.status(401).json({ 
      error: 'Authentication required',
      code: 'NOT_AUTHENTICATED',
      message: 'Please log in to access this resource'
    });
    return;
  }

  // Validate session
  const session = validateSession(sessionId);
  
  if (!session) {
    // Clear the invalid cookie
    res.clearCookie('session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.status(401).json({ 
      error: 'Session expired',
      code: 'SESSION_EXPIRED',
      message: 'Your session has expired. Please log in again.'
    });
    return;
  }

  // Check if user is the admin
  const adminUserId = getAdminUserId();
  
  if (adminUserId !== null && session.userId !== adminUserId) {
    res.status(403).json({ 
      error: 'Access denied',
      code: 'NOT_ADMIN',
      message: 'Only the administrator can access this resource'
    });
    return;
  }

  // Attach user to request
  req.user = {
    id: session.userId,
    login: session.userLogin,
    name: session.userName,
    email: session.userEmail,
    avatarUrl: session.userAvatarUrl,
    sessionId,
  };

  next();
}

/**
 * Middleware that only checks if user is authenticated (doesn't require admin)
 * Use this for endpoints that any authenticated user can access
 */
export function requireSession(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Get session ID from cookie
  const sessionId = req.cookies?.session;
  
  if (!sessionId) {
    res.status(401).json({ 
      error: 'Authentication required',
      code: 'NOT_AUTHENTICATED',
      message: 'Please log in to access this resource'
    });
    return;
  }

  // Validate session
  const session = validateSession(sessionId);
  
  if (!session) {
    res.clearCookie('session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.status(401).json({ 
      error: 'Session expired',
      code: 'SESSION_EXPIRED',
      message: 'Your session has expired. Please log in again.'
    });
    return;
  }

  // Attach user to request
  req.user = {
    id: session.userId,
    login: session.userLogin,
    name: session.userName,
    email: session.userEmail,
    avatarUrl: session.userAvatarUrl,
    sessionId,
  };

  next();
}
