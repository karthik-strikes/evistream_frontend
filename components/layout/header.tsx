'use client';

import { Bell, User, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { authService } from '@/services/auth.service';

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const handleLogout = () => {
    authService.logout();
  };

  return (
    <div className="flex h-16 items-center justify-between border-b border-border bg-white px-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon"><Bell className="h-5 w-5" /></Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon"><User className="h-5 w-5" /></Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Account</DialogTitle></DialogHeader>
            <DialogFooter>
              <Button onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" />Sign Out</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
