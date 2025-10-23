# Security Setup Guide

## Overview
The application now implements role-based access control (RBAC) to protect your business data from competitors and unauthorized access.

## Access Levels

### Public Sports Data (No Auth Required)
- **Countries**: Public sports reference data
- **Leagues**: League information
- **Fixtures**: Match schedules and details

### Protected Business Intelligence (Admin Only)
- **Analysis Cache**: Proprietary analysis algorithms and predictions
- **Odds Cache**: Real-time odds data from bookmakers
- **Optimizer Cache**: Betting optimization strategies and value calculations
- **Stats Cache**: Historical statistics and computed metrics

### User-Specific Data
- **Generated Tickets**: Users can only view their own betting tickets
- **User Roles**: Users can view their own roles; admins can manage all roles

## Creating Your First Admin

After deploying, you need to manually add the first admin user. Use the Lovable Cloud backend:

1. **Sign up a user account** in your application
2. **Get the user's UUID** from the auth.users table
3. **Add admin role** by inserting into user_roles:

```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('YOUR_USER_UUID_HERE', 'admin');
```

## Adding Additional Admins

Once you have an admin account, admins can:
- View all user roles in the backend
- Add/remove admin roles for other users
- Access all protected business intelligence

## Security Features Implemented

✅ **Role-Based Access Control**: Separate user_roles table prevents privilege escalation
✅ **Security Definer Functions**: Prevents RLS recursion issues
✅ **User Data Isolation**: Users can only access their own tickets
✅ **Business Data Protection**: Analysis, odds, and optimizer caches restricted to admins
✅ **Service Role Access**: Backend functions maintain full access for automation

## Best Practices

1. **Limit Admin Accounts**: Only give admin role to trusted team members
2. **Regular Audits**: Periodically review user_roles table
3. **Secure Credentials**: Never share admin credentials
4. **Monitor Access**: Check backend logs for suspicious activity

## Troubleshooting

### "Permission denied" errors
- Ensure user has correct role in user_roles table
- Verify RLS policies are active: `ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;`

### Cannot see generated tickets
- Tickets must be created after the security update
- Existing tickets without user_id will not be visible to users
- Service role can query/update old tickets to add user_id if needed
