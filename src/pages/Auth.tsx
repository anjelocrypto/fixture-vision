import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, Check, X, AtSign } from "lucide-react";
import Footer from "@/components/Footer";
import { useTranslation } from "react-i18next";
import { useUsername } from "@/hooks/useUsername";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Auth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation(['common']);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showEmailVerificationDialog, setShowEmailVerificationDialog] = useState(false);
  
  // Username state
  const {
    username,
    isValid: usernameValid,
    isAvailable: usernameAvailable,
    isChecking: usernameChecking,
    error: usernameError,
    setUsername,
    createProfileWithUsername,
  } = useUsername();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!acceptedTerms) {
      toast({
        title: t('common:terms_required'),
        description: t('common:terms_accept_message'),
        variant: "destructive",
      });
      return;
    }
    
    // Validate username
    if (!usernameValid || usernameAvailable === false) {
      toast({
        title: "Invalid Username",
        description: usernameError || "Please choose a valid username",
        variant: "destructive",
      });
      return;
    }
    
    if (usernameAvailable !== true) {
      toast({
        title: "Checking Username",
        description: "Please wait for username validation",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (error) throw error;

      // After signup, create profile with username
      if (data.user) {
        // Wait for session to be established
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const result = await createProfileWithUsername(username);
        if (!result.success) {
          console.error("Failed to create profile with username:", result.error);
          // Non-blocking - profile will have default username
        }
      }

      toast({
        title: t('common:success'),
        description: t('common:signup_success'),
      });
      
      navigate("/");
    } catch (error: any) {
      toast({
        title: t('common:signup_failed'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      toast({
        title: t('common:welcome_back'),
        description: t('common:success_signed_in'),
      });

      navigate("/");
    } catch (error: any) {
      // Check if it's an email confirmation error
      const isEmailNotConfirmed = error.message?.toLowerCase().includes('email not confirmed');
      
      if (isEmailNotConfirmed) {
        setShowEmailVerificationDialog(true);
      } else {
        toast({
          title: t('common:signin_failed'),
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Username validation indicator
  const UsernameStatus = () => {
    if (!username) return null;
    
    if (usernameChecking) {
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    }
    
    if (usernameValid && usernameAvailable === true) {
      return <Check className="h-4 w-4 text-green-500" />;
    }
    
    if (usernameError || usernameAvailable === false) {
      return <X className="h-4 w-4 text-destructive" />;
    }
    
    return null;
  };

  return (
    <>
      <AlertDialog open={showEmailVerificationDialog} onOpenChange={setShowEmailVerificationDialog}>
        <AlertDialogContent className="bg-card border-primary/20">
          <AlertDialogHeader>
            <div className="flex items-center justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="h-8 w-8 text-primary" />
              </div>
            </div>
            <AlertDialogTitle className="text-center text-2xl">
              📧 Verify Your Email
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-base">
              Please check your inbox and click the verification link we sent you to activate your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="w-full">
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-background via-background to-secondary/20 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-2xl text-center">
                <span className="text-primary animate-glow">TICKET 1.0 BETA</span>
              </CardTitle>
              <CardDescription className="text-center">
                {t('common:generate_optimized_betting_tickets')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="signin" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">{t('common:sign_in')}</TabsTrigger>
                  <TabsTrigger value="signup">{t('common:sign_up')}</TabsTrigger>
                </TabsList>
                
                <TabsContent value="signin">
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signin-email">{t('common:email')}</Label>
                      <Input
                        id="signin-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={loading}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="signin-password">{t('common:password')}</Label>
                        <Link 
                          to="/forgot-password" 
                          className="text-sm text-primary hover:underline"
                        >
                          {t('common:forgot_password')}
                        </Link>
                      </div>
                      <Input
                        id="signin-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={loading}
                        minLength={6}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {t('common:sign_in')}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup">
                  <form onSubmit={handleSignUp} className="space-y-4">
                    {/* Username field - REQUIRED */}
                    <div className="space-y-2">
                      <Label htmlFor="signup-username">Username *</Label>
                      <div className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                          <AtSign className="h-4 w-4" />
                        </div>
                        <Input
                          id="signup-username"
                          type="text"
                          placeholder="your_username"
                          value={username}
                          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                          required
                          disabled={loading}
                          className="pl-9 pr-10"
                          maxLength={20}
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <UsernameStatus />
                        </div>
                      </div>
                      {usernameError && (
                        <p className="text-xs text-destructive">{usernameError}</p>
                      )}
                      {usernameValid && usernameAvailable === true && (
                        <p className="text-xs text-green-500">✓ Username available</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        3-20 characters, letters, numbers, underscore only
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">{t('common:email')}</Label>
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={loading}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">{t('common:password')}</Label>
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={loading}
                        minLength={6}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('common:password_min_length')}
                      </p>
                    </div>
                    <div className="flex items-start space-x-2">
                      <Checkbox 
                        id="terms" 
                        checked={acceptedTerms}
                        onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                        disabled={loading}
                      />
                      <label
                        htmlFor="terms"
                        className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {t('common:i_agree_to')}{" "}
                        <Link to="/legal/terms" className="text-primary hover:underline" target="_blank">
                          {t('common:terms_of_service')}
                        </Link>
                        {" "}{t('common:and')}{" "}
                        <Link to="/legal/privacy" className="text-primary hover:underline" target="_blank">
                          {t('common:privacy_policy')}
                        </Link>
                      </label>
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={loading || !acceptedTerms || !usernameValid || usernameAvailable !== true}
                    >
                      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {t('common:create_account')}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    </>
  );
}