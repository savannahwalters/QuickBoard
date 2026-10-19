import { bootstrapApplication } from '@angular/platform-browser';
import { AppSettingsService } from './services/app-settings.service';

async function bootstrap(): Promise<void> {
  // Hydrate before importing the app: stores capture defaults at module evaluation time.
  await new AppSettingsService().loadCurrentSettings();
  const [{ appConfig }, { App }] = await Promise.all([
    import('./app/app.config'),
    import('./app/app'),
  ]);
  await bootstrapApplication(App, appConfig);
}

void bootstrap().catch((err) => console.error(err));
