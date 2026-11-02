import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { shortcutKeys, shortcuts } from 'src/shared/shortcuts';

@Component({
  selector: 'app-keyboard-shortcuts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <div class="dialog">
        <header class="dialog-header">
          <div class="header-row">
            <h1 class="title" id="shortcuts-title">Keyboard Shortcuts</h1>
            <button
              class="close-button"
              type="button"
              title="Close"
              aria-label="Close keyboard shortcuts"
              (click)="close()"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </div>
          <label class="search">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input
              type="search"
              aria-label="Search shortcuts"
              placeholder="Search shortcuts"
              [value]="query()"
              (input)="onSearch($event)"
            />
          </label>
        </header>
        <main>
          @for (group of groups(); track group.name) {
          <section class="shortcuts-section" [attr.aria-label]="group.name">
            <h2 class="section-title">{{ group.name }}</h2>
            <dl>
              @for (shortcut of group.shortcuts; track $index) {
              <div class="shortcut">
                <dt>{{ shortcut.label }}</dt>
                <dd>
                  @for (key of keys(shortcut); track $index) { <kbd>{{ key }}</kbd> }
                </dd>
              </div>
              }
            </dl>
          </section>
          } @empty {
          <p role="status">No matching shortcuts.</p>
          }
        </main>
      </div>
    </div>
  `,
  styleUrls: ['../dialog-window.css', './keyboard-shortcuts.component.css'],
})
export class KeyboardShortcutsComponent {
  protected readonly query = signal('');
  protected readonly keys = shortcutKeys;
  protected readonly groups = computed(() => {
    const query = this.query().trim().toLowerCase();
    return ['Application', 'File', 'Editing', 'Boards', 'Timeline', 'Canvas', 'Tools']
      .map((name) => ({
        name,
        shortcuts: shortcuts.filter(
          (shortcut) =>
            shortcut.group === name &&
            `${name} ${shortcut.label} ${shortcutKeys(shortcut).join(' ')}`
              .toLowerCase()
              .includes(query)
        ),
      }))
      .filter((group) => group.shortcuts.length > 0);
  });

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected close(): void {
    window.close();
  }
}
