# Frontend Production-Ready Overhaul

Refactor the existing frontend into a scalable, multi-page application with robust state management and real-time processing feedback.

## User Review Required

> [!IMPORTANT]
> The current theme is high-fidelity "Notion-style". I will preserve this aesthetic while moving to a modular component architecture.

## Proposed Changes

### [Core Infrastructure]
- **State Management**: Implement Redux Toolkit with `auth` and `session` slices.
- **API Layer**: Use RTK Query to handle authentication, uploads, and automated polling for session status.
- **Routing**: Integrate `react-router-dom` with protected route guards.

### [Components]
- #### [MODIFIED] [AppLayout](file:///d:/ai-meeting-assistant/frontend/ai-session-assistent/src/layouts/AppLayout.jsx)
  - Sidebar and header structure (refactored from `App.jsx`).
- #### [MODIFIED] [AuthLayout](file:///d:/ai-meeting-assistant/frontend/ai-session-assistent/src/layouts/AuthLayout.jsx)
  - Centered container for login/register forms.

### [Pages]
- #### [NEW] [LoginPage](file:///d:/ai-meeting-assistant/frontend/ai-session-assistent/src/pages/LoginPage.jsx)
- #### [NEW] [RegisterPage](file:///d:/ai-meeting-assistant/frontend/ai-session-assistent/src/pages/RegisterPage.jsx)
- #### [NEW] [DashboardPage](file:///d:/ai-meeting-assistant/frontend/ai-session-assistent/src/pages/DashboardPage.jsx)
  - The "Empty State" with upload options.
- #### [NEW] [SessionViewPage](file:///d:/ai-meeting-assistant/frontend/ai-session-assistent/src/pages/SessionViewPage.jsx)
  - The report view and chat interface.

## Verification Plan

### Automated Tests
- Mocking backend responses to verify the "Processing" UI states.

### Manual Verification
- Upload a file and verify the transition from "Uploading" to "Processing" to "Report Visible".
- Verify that logging out clears state and redirects to login.
