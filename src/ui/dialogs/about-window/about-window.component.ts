import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';

@Component({
  selector: 'app-about-window',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './about-window.component.html',
  styleUrl: './about-window.component.css',
})
export class AboutWindowComponent implements OnInit {
  protected readonly description = signal('');
  protected readonly version = signal('unknown');
  readonly githubUrl = 'https://github.com/savannahwalters/QuickBoard';

  ngOnInit() {
    const params = new URLSearchParams(window.location.search);
    this.description.set(params.get('description') ?? '');
    this.version.set(params.get('version') ?? 'unknown');
  }

  protected openGitHub(): void {
    window.quickboard?.openExternal(this.githubUrl);
  }
}
