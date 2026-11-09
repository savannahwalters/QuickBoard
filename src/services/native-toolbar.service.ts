import { Injectable } from '@angular/core';
import { PluginListenerHandle, registerPlugin } from '@capacitor/core';
import themes from '../shared/themes.json';
import type { ThemeId } from '../shared/theme-types';

export type { ThemeId } from '../shared/theme-types';

type NativeMenuAction =
  | 'app.about'
  | 'app.settings'
  | 'file.save'
  | 'file.saveAs'
  | 'file.load'
  | 'file.export'
  | 'file.importImage'
  | 'edit.undo'
  | 'edit.redo'
  | `theme.${ThemeId}`;

export interface NativeToolbarPlugin {
  setTitle(options: { title: string }): Promise<void>;
  configureMenu(options: {
    themeItems: { id: string; label: string }[];
    currentTheme: ThemeId;
  }): Promise<void>;
  addListener(
    eventName: 'menuAction',
    listenerFunc: (event: { actionId: NativeMenuAction }) => void,
  ): Promise<PluginListenerHandle>;
}

const NativeToolbar = registerPlugin<NativeToolbarPlugin>('NativeToolbar');

@Injectable({
  providedIn: 'root',
})
export class NativeToolbarService {
  private menuListener?: PluginListenerHandle;

  async setTitle(title: string): Promise<void> {
    try {
      await NativeToolbar.setTitle({ title });
    } catch (error) {
      console.warn('NativeToolbar plugin is not available on this platform.', error);
    }
  }

  async configureMenu(currentTheme: ThemeId): Promise<void> {
    try {
      await NativeToolbar.configureMenu({
        themeItems: themes.map((theme) => ({ id: theme.id, label: theme.label })),
        currentTheme,
      });
    } catch (error) {
      console.warn('Unable to configure iPad menu bar.', error);
    }
  }

  async onMenuAction(handler: (actionId: NativeMenuAction) => void): Promise<() => void> {
    try {
      this.menuListener?.remove();
      this.menuListener = await NativeToolbar.addListener('menuAction', ({ actionId }) => {
        handler(actionId);
      });
      return () => this.menuListener?.remove();
    } catch (error) {
      console.warn('Unable to register native menu action listener.', error);
      return () => {
        // No listener was installed.
      };
    }
  }
}
