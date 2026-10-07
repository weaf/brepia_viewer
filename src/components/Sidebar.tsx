import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  LayoutGrid,
  Box,
  LogOut,
  Menu,
  MessageCircle,
  Monitor,
  Moon,
  Plus,
  Settings,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useAppearance } from '@/contexts/AppearanceContext';
import { supabase, ssoProvider } from '@/lib/supabase';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useQuery } from '@tanstack/react-query';
import { ConditionalWrapper } from './ConditionalWrapper';
import { DiscordIcon, GitHubIcon } from './icons/CompanyIcons';
import { cn } from '@/lib/utils';
import { Conversation, ConversationSettings } from '@shared/types';
import { UserAvatar } from '@/components/chat/UserAvatar';
import { useProfile } from '@/services/profileService';
import { getInstanceIdentity } from '@/services/instanceIdentityService';
import { getAccountAccess } from '@/services/accountAdminService';
import {
  ADMIN_CONVERSATION_IDS_EVENT,
  readAdminConversationIdsEnabled,
} from '@/lib/adminConversationIdentifiers';
import { BrepiaBrand, BrepiaMark } from '@/components/brand';

interface SidebarProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
}

type SidebarPath = '/app' | '/history' | '/brep';

const appearanceOptions = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const;

function DesktopSidebar({ isSidebarOpen, setIsSidebarOpen }: SidebarProps) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { appearance, setAppearance } = useAppearance();
  const isMobile = useIsMobile();
  const { data: profile } = useProfile();
  const { data: access } = useQuery({
    queryKey: ['account-access'],
    queryFn: getAccountAccess,
  });
  const [showConversationIds, setShowConversationIds] = useState(
    readAdminConversationIdsEnabled,
  );
  const { data: instanceIdentity } = useQuery({
    queryKey: ['instance-identity'],
    queryFn: getInstanceIdentity,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onPreferenceChanged = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      setShowConversationIds(
        typeof detail === 'boolean'
          ? detail
          : readAdminConversationIdsEnabled(),
      );
    };
    const onStorage = () =>
      setShowConversationIds(readAdminConversationIdsEnabled());

    window.addEventListener(ADMIN_CONVERSATION_IDS_EVENT, onPreferenceChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(
        ADMIN_CONVERSATION_IDS_EVENT,
        onPreferenceChanged,
      );
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const showAdminConversationIds =
    access?.role === 'admin' && showConversationIds;
  const communityUrl =
    instanceIdentity?.showCommunityLink && instanceIdentity.communityUrl
      ? instanceIdentity.communityUrl
      : null;
  const communityLabel = instanceIdentity?.communityLabel || 'Community';
  const discordUrl = instanceIdentity?.discordUrl ?? null;

  // Get 10 most recent conversations
  const { data: recentConversations } = useQuery<Conversation[]>({
    queryKey: ['conversations', 'recent'],
    initialData: [],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .eq('user_id', user?.id ?? '')
        .limit(10)
        .overrideTypes<Array<{ settings: ConversationSettings }>>();

      if (error) throw error;

      return data;
    },
  });

  const handleSignOut = async () => {
    try {
      if (ssoProvider) {
        // In SSO mode root is the app's only auth surface, so sign-out lands
        // there. Navigate BEFORE the session dies: on a guarded route the
        // AuthGuard would otherwise fire the provider redirect the moment the
        // session goes away and sign the user straight back in.
        await navigate({ to: '/app' });
        await signOut();
        return;
      }
      await signOut();
      navigate({ to: '/signin' });
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const sidebarNavigate = (path: SidebarPath) => {
    if (isMobile) {
      setIsSidebarOpen(false); // setIsSidebarOpen is actually setOpen from Sheet component
    }
    navigate({ to: path });
  };

  const renderUserSectionTrigger = () => {
    if (isSidebarOpen) {
      return (
        <div className="flex cursor-pointer items-center space-x-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent-foreground">
          <UserAvatar />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-adam-text-primary">
              {profile?.full_name || user?.email?.split('@')[0] || 'User'}
            </span>
            <span className="text-xs text-adam-text-tertiary dark:text-gray-400">
              {user?.email}
            </span>
          </div>
        </div>
      );
    }

    return (
      <Button
        variant="adam_dark_collapsed_avatar"
        className="group ml-[1px] h-[46px] w-[46px] px-0 py-6"
      >
        <UserAvatar className="h-[30px] w-[30px] transition-all duration-200 ease-in-out group-hover:h-[26px] group-hover:w-[26px] group-hover:ring-2 group-hover:ring-adam-neutral-500" />
      </Button>
    );
  };

  return (
    <div
      className={`${isSidebarOpen ? 'w-64' : 'w-16'} flex h-full flex-shrink-0 flex-col bg-adam-bg-dark pb-2 transition-all duration-300 ease-in-out dark:bg-gray-950`}
    >
      <div className="p-4 dark:border-gray-800">
        <ConditionalWrapper
          condition={!isSidebarOpen}
          wrapper={(children) => (
            <Tooltip>
              <TooltipTrigger asChild>{children}</TooltipTrigger>
              <TooltipContent side="right" className="flex flex-col">
                <span className="font-semibold">Home</span>
                <span className="text-xs text-muted-foreground">Home Page</span>
              </TooltipContent>
            </Tooltip>
          )}
        >
          <button
            type="button"
            aria-label="Brepia-viewer home"
            className="flex w-full cursor-pointer items-center space-x-2"
            onClick={() => sidebarNavigate('/app')}
          >
            {isSidebarOpen ? (
              <div className="flex w-full justify-center">
                <BrepiaBrand
                  className="py-0.5"
                  markClassName="h-8 w-8"
                  wordmarkClassName="text-[15px]"
                />
              </div>
            ) : (
              <BrepiaMark title="Brepia-viewer" className="h-8 w-8 min-w-8" />
            )}
          </button>
        </ConditionalWrapper>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className={`${isSidebarOpen ? 'px-4' : 'px-2'} flex-1 py-2 transition-all duration-300 ease-in-out`}
        >
          <ConditionalWrapper
            condition={!isSidebarOpen}
            wrapper={(children) => (
              <Tooltip>
                <TooltipTrigger asChild>{children}</TooltipTrigger>
                <TooltipContent side="right" className="flex flex-col">
                  <span className="font-semibold">New Creation</span>
                  <span className="text-xs text-muted-foreground">
                    Start a new conversation
                  </span>
                </TooltipContent>
              </Tooltip>
            )}
          >
            <div className="ml-[9px]">
              <Button
                variant="secondary"
                className={` ${
                  isSidebarOpen
                    ? 'flex w-[216px] items-center justify-start gap-2 rounded-[100px] border border-adam-blue bg-adam-background-1 px-4 py-3 text-[#D7D7D7] hover:bg-adam-blue/40 hover:text-adam-text-primary'
                    : 'flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border-2 border-adam-blue bg-[#191A1A] p-[2px] text-[#D7D7D7] shadow-[0px_4px_10px_0px_rgba(0,166,255,0.24)] hover:bg-adam-blue/40 hover:text-adam-text-primary'
                } mb-4`}
                onClick={() => sidebarNavigate('/app')}
              >
                <Plus
                  className={`h-5 w-5 ${!isSidebarOpen ? 'text-adam-neutral-300 hover:text-adam-text-primary' : ''}`}
                />
                {isSidebarOpen && (
                  <div className="text-sm font-semibold leading-[14px] tracking-[-0.14px] text-adam-neutral-200">
                    New Creation
                  </div>
                )}
              </Button>
            </div>
          </ConditionalWrapper>
          <ConditionalWrapper
            condition={!isSidebarOpen}
            wrapper={(children) => (
              <Tooltip>
                <TooltipTrigger asChild>{children}</TooltipTrigger>
                <TooltipContent side="right">
                  Saved native BRep models
                </TooltipContent>
              </Tooltip>
            )}
          >
            <div className="ml-[9px]">
              <Button
                variant={isSidebarOpen ? 'adam_dark' : 'adam_dark_collapsed'}
                className={`${isSidebarOpen ? 'mb-4 w-[216px] justify-start gap-2' : 'mb-4 ml-[1px] h-[30px] w-[30px] p-[2px]'}`}
                onClick={() => sidebarNavigate('/brep')}
              >
                <Box className="h-5 w-5" />
                {isSidebarOpen && 'BRep Models'}
              </Button>
            </div>
          </ConditionalWrapper>
          <nav className="space-y-1">
            {[
              {
                icon: LayoutGrid,
                label: 'Creations',
                href: '/history' as const,
                description: 'View past creations',
                submenu: recentConversations,
              },
            ].map(({ icon: Icon, label, href, description, submenu }) => (
              <div key={label} className="space-y-1">
                <ConditionalWrapper
                  condition={!isSidebarOpen}
                  wrapper={(children) => (
                    <Tooltip>
                      <TooltipTrigger asChild>{children}</TooltipTrigger>
                      <TooltipContent side="right" className="flex flex-col">
                        <span className="font-semibold">{label}</span>
                        <span className="text-xs text-muted-foreground">
                          {description}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  )}
                >
                  <Button
                    variant={
                      isSidebarOpen ? 'adam_dark' : 'adam_dark_collapsed'
                    }
                    onClick={() => sidebarNavigate(href)}
                    className={`${isSidebarOpen ? 'w-full justify-start' : 'ml-[1px] h-[46px] w-[46px] p-0'}`}
                  >
                    <Icon
                      className={`${isSidebarOpen ? 'mr-2' : ''} h-[22px] w-[22px] min-w-[22px]`}
                    />
                    {isSidebarOpen && label}
                  </Button>
                </ConditionalWrapper>
                {isSidebarOpen && submenu && (
                  <ul className="ml-7 flex list-none flex-col gap-1 border-l border-adam-neutral-500 px-2">
                    {submenu.map(
                      (
                        conversation: Omit<
                          Conversation,
                          'message_count' | 'last_message_at'
                        >,
                      ) => {
                        return (
                          <Link
                            to="/project/$id"
                            params={{ id: conversation.id }}
                            key={conversation.id}
                            onClick={() => {
                              if (isMobile) {
                                setIsSidebarOpen(false);
                              }
                            }}
                          >
                            <li className="rounded-md p-1 transition-colors duration-200 ease-in-out [@media(hover:hover)]:hover:bg-adam-neutral-950">
                              <span className="line-clamp-1 text-ellipsis text-nowrap text-xs font-medium text-adam-neutral-400 [@media(hover:hover)]:hover:text-adam-neutral-10">
                                {conversation.title || conversation.id}
                              </span>
                              {showAdminConversationIds && (
                                <span className="mt-0.5 block font-mono text-[10px] text-adam-neutral-500">
                                  {conversation.id.slice(0, 8)}
                                </span>
                              )}
                            </li>
                          </Link>
                        );
                      },
                    )}
                  </ul>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div
          className={`${isSidebarOpen ? 'px-4' : 'px-2'} py-4 transition-all duration-300 ease-in-out dark:border-gray-800`}
        >
          <div className={cn('flex flex-col gap-2', isSidebarOpen && 'gap-3')}>
            {/* GitHub Button - Collapsed state */}
            {!isSidebarOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="https://github.com/weaf/brepia"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      variant="adam_dark_collapsed"
                      className="mb-0 ml-[1px] h-[46px] w-[46px] p-0"
                    >
                      <GitHubIcon className="h-[22px] w-[22px]" />
                    </Button>
                  </a>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex flex-col">
                  <span className="font-semibold">GitHub</span>
                  <span className="text-xs text-muted-foreground">
                    View source code
                  </span>
                </TooltipContent>
              </Tooltip>
            )}

            {/* GitHub Button - Expanded state */}
            {isSidebarOpen && (
              <a
                href="https://github.com/weaf/brepia"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="adam_dark"
                  className="flex h-10 w-full items-center justify-start gap-2"
                >
                  <GitHubIcon className="h-[22px] w-[22px] min-w-[22px]" />
                  GitHub
                </Button>
              </a>
            )}

            {discordUrl && !isSidebarOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={discordUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      variant="adam_dark_collapsed"
                      className="mb-0 ml-[1px] h-[46px] w-[46px] p-0"
                      aria-label="Discord"
                    >
                      <DiscordIcon className="h-[22px] w-[22px]" />
                    </Button>
                  </a>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex flex-col">
                  <span className="font-semibold">Discord</span>
                  <span className="text-xs text-muted-foreground">
                    Open Discord
                  </span>
                </TooltipContent>
              </Tooltip>
            )}

            {discordUrl && isSidebarOpen && (
              <a href={discordUrl} target="_blank" rel="noopener noreferrer">
                <Button
                  variant="adam_dark"
                  className="flex h-10 w-full items-center justify-start gap-2"
                >
                  <DiscordIcon className="h-[22px] w-[22px] min-w-[22px]" />
                  Discord
                </Button>
              </a>
            )}

            {communityUrl && !isSidebarOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={communityUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      variant="adam_dark_collapsed"
                      className="mb-0 ml-[1px] h-[46px] w-[46px] p-0"
                      aria-label={communityLabel}
                    >
                      <MessageCircle className="h-[22px] w-[22px]" />
                    </Button>
                  </a>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex flex-col">
                  <span className="font-semibold">{communityLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    Open community
                  </span>
                </TooltipContent>
              </Tooltip>
            )}

            {communityUrl && isSidebarOpen && (
              <a href={communityUrl} target="_blank" rel="noopener noreferrer">
                <Button
                  variant="adam_dark"
                  className="flex h-10 w-full items-center justify-start gap-2"
                >
                  <MessageCircle className="h-[22px] w-[22px] min-w-[22px]" />
                  {communityLabel}
                </Button>
              </a>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {renderUserSectionTrigger()}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56"
                align="end"
                side={isMobile ? 'top' : 'right'}
              >
                <div className="flex items-center space-x-2 p-2">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium text-adam-text-primary">
                      {profile?.full_name ||
                        user?.email?.split('@')[0] ||
                        'User'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {user?.email}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuGroup className="text-adam-text-primary">
                  <DropdownMenuItem asChild>
                    <Link
                      to="/settings"
                      className="flex items-center"
                      onClick={() => {
                        if (isMobile) {
                          setIsSidebarOpen(false);
                        }
                      }}
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <div className="flex items-center justify-between gap-3 bg-adam-background-2 px-2 py-2">
                    <span className="text-sm text-adam-text-primary">
                      Appearance
                    </span>
                    <div
                      className="flex items-center gap-1"
                      role="group"
                      aria-label="Appearance"
                    >
                      {appearanceOptions.map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          type="button"
                          title={label}
                          aria-label={`${label} appearance`}
                          aria-pressed={appearance === value}
                          onClick={() => setAppearance(value)}
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-md text-adam-text-tertiary transition-colors hover:bg-adam-neutral-800 hover:text-adam-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                            appearance === value &&
                              'bg-adam-neutral-800 text-adam-text-primary ring-1 ring-adam-neutral-700',
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                      ))}
                    </div>
                  </div>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4 text-adam-text-primary" />
                  <span className="text-adam-text-primary">Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileSidebar({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isSidebarOpen,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setIsSidebarOpen,
}: SidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-2 top-2.5 z-50 hover:bg-adam-neutral-700 md:hidden"
        >
          <Menu className="h-5 w-5 text-adam-text-primary" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="bg-adam-bg-dark p-0">
        {/* For aria stuff */}
        <SheetHeader className="hidden">
          <SheetTitle className="text-adam-text-primary">Brepia-viewer</SheetTitle>
          <SheetDescription>AI-assisted parametric 3D design</SheetDescription>
        </SheetHeader>
        <DesktopSidebar isSidebarOpen={true} setIsSidebarOpen={setOpen} />
      </SheetContent>
    </Sheet>
  );
}

export function Sidebar({ isSidebarOpen, setIsSidebarOpen }: SidebarProps) {
  const isMobile = useIsMobile();
  const { user } = useAuth();

  // Don't display the sidebar if the user isn't logged in
  if (user == null) {
    return <></>;
  }

  return isMobile ? (
    <MobileSidebar
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
    />
  ) : (
    <DesktopSidebar
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
    />
  );
}
