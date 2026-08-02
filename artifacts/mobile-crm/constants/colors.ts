/**
 * Semantic design tokens for the mobile CRM.
 * Primary color and other brand values come from client.config.ts.
 */
import { CLIENT } from '../client.config';

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#0B1B33',
    tint: CLIENT.primaryColor,

    // Core surfaces
    background: '#F7F8FB',
    foreground: '#0B1B33',

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#0B1B33',

    // Primary action color (buttons, links, active states)
    primary: CLIENT.primaryColor,
    primaryForeground: '#FFFFFF',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#EAEEF6',
    secondaryForeground: '#122A4D',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#EEF1F7',
    mutedForeground: '#5B6B84',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#E3EAFB',
    accentForeground: CLIENT.primaryColor,

    // Destructive actions (delete, error states)
    destructive: '#DC2626',
    destructiveForeground: '#FFFFFF',

    // Success
    success: '#15803D',
    successForeground: '#FFFFFF',

    // Warning
    warning: '#B45309',
    warningForeground: '#FFFFFF',

    // Borders and input outlines
    border: '#DFE4EE',
    input: '#DFE4EE',
  },

  // Border radius (px) — mirrors the web artifact's 0.25rem radius, slightly
  // scaled up for touch surfaces.
  radius: 10,
};

export default colors;
