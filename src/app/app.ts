import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { NAV_ITEMS, PRIMARY_NAV, SECONDARY_NAV } from './core/navigation';
import { Icon } from './shared/ui/icon/icon';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly navItems = NAV_ITEMS;
  protected readonly primaryNav = PRIMARY_NAV;
  protected readonly secondaryNav = SECONDARY_NAV;

  /** The "עוד" sheet on mobile — four tabs is all that fits comfortably. */
  protected readonly moreOpen = signal(false);

  constructor(router: Router) {
    router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.moreOpen.set(false));
  }

  protected toggleMore() {
    this.moreOpen.update((open) => !open);
  }

  protected closeMore() {
    this.moreOpen.set(false);
  }
}
