# Mental Health Module

This module will be implemented by the mental health team.

## Placeholder

This directory is reserved for the mental health module implementation. It will be completely isolated from the sedentary module with its own:

- Logic
- Models
- Datasets
- API routes
- UI Components

## Integration Notes

When the mental module is ready:

1. Create your module files in this directory
2. Follow the same pattern as the sedentary module (see `src/modules/sedentary/`)
3. Do NOT modify any files outside this directory
4. The Router will automatically route to your module when `window.__yogmitraActiveModule` is set to `'mental'`

## Current Status

- Status: Not started
- To activate: Set `window.__yogmitraActiveModule = 'mental'` before app boot
