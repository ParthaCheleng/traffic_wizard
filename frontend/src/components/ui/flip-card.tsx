"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export interface FlipCardField {
  name: string
  type?: string
  label: string
  placeholder?: string
}

export interface FlipCardProps {
  frontTitle?: string
  frontDescription?: string
  frontIllustration?: React.ReactNode
  frontContent?: React.ReactNode
  backTitle?: string
  backDescription?: string
  backIllustration?: React.ReactNode
  successTitle?: string
  successDescription?: string
  successIllustration?: React.ReactNode
  fields?: FlipCardField[]
  onLogin?: (data: Record<string, string>) => Promise<boolean> | boolean
  loginButtonText?: string
  backButtonText?: string
  successButtonText?: string
  className?: string
  cardWidth?: number
  cardHeight?: number
  showBackInitially?: boolean
}

export default function FlipCard({
  frontTitle = "Welcome Back 👋",
  frontDescription = "Login to continue",
  frontIllustration,
  frontContent,
  backTitle = "Login Form",
  backDescription = "Fill your details",
  backIllustration,
  successTitle = "Login Successful 🎉",
  successDescription = "You are now logged in!",
  successIllustration,
  fields = [
    { name: "email", type: "email", label: "Email", placeholder: "Enter your email" },
    { name: "password", type: "password", label: "Password", placeholder: "Enter your password" },
  ],
  onLogin,
  loginButtonText = "Login",
  backButtonText = "Back",
  successButtonText = "Continue",
  className,
  cardWidth = 320,
  cardHeight = 420,
  showBackInitially = false,
}: FlipCardProps) {
  const [flipped, setFlipped] = React.useState(showBackInitially)
  const [formData, setFormData] = React.useState<Record<string, string>>({})
  const [success, setSuccess] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      if (onLogin) {
        const result = await onLogin(formData)
        if (result) {
          setSuccess(true)
          setFlipped(false)
        } else {
          setError("Invalid input")
        }
      } else {
        setSuccess(true)
        setFlipped(false)
      }
    } catch (err) {
      setError("An error occurred")
    }
    setLoading(false)
  }

  return (
    <div className={cn("perspective-1000", className)} style={{ width: cardWidth, height: cardHeight }}>
      <motion.div
        className="relative w-full h-full"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.6 }}
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* FRONT SIDE */}
        <Card className="absolute w-full h-full backface-hidden bg-zinc-900 border-zinc-800 text-white shadow-xl rounded-2xl p-6 flex flex-col justify-center items-center">
          {!success ? (
            <>
              {frontIllustration ?? <div className="w-20 h-20 bg-blue-900 rounded-full mb-4" />}
              <CardHeader className="px-0 pt-0 pb-2">
                <CardTitle className="text-xl font-semibold text-center">{frontTitle}</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-4 text-center text-sm text-zinc-400">
                {frontDescription}
                {frontContent}
              </CardContent>
              <Button className="mt-auto w-full bg-blue-600 hover:bg-blue-500 text-white" onClick={() => setFlipped(true)}>
                {loginButtonText}
              </Button>
            </>
          ) : (
            <>
              {successIllustration ?? <div className="w-20 h-20 bg-green-900 rounded-full mb-4" />}
              <CardHeader className="px-0 pt-0 pb-2">
                <CardTitle className="text-xl font-semibold text-center">{successTitle}</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-4 text-center text-sm text-zinc-400">
                {successDescription}
              </CardContent>
            </>
          )}
        </Card>

        {/* BACK SIDE */}
        <Card
          className="absolute w-full h-full backface-hidden bg-zinc-900 border-zinc-800 text-white shadow-xl rounded-2xl p-6 flex flex-col justify-center"
          style={{ transform: "rotateY(180deg)" }}
        >
          {backIllustration}
          <h3 className="text-xl font-semibold mb-2">{backTitle}</h3>
          <p className="text-sm text-zinc-400 mb-6">{backDescription}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {fields.map((field) => (
              <div key={field.name} className="flex flex-col">
                <label className="text-sm font-medium mb-1.5">{field.label}</label>
                <Input
                  name={field.name}
                  type={field.type || "text"}
                  placeholder={field.placeholder}
                  value={formData[field.name] || ""}
                  onChange={handleChange}
                  className="bg-zinc-800 border-zinc-700 text-white focus-visible:ring-blue-500"
                />
              </div>
            ))}
            {error && <p className="text-sm text-red-500">{error}</p>}
            
            <div className="pt-2 space-y-2">
              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white" disabled={loading}>
                {loading ? "Processing..." : loginButtonText}
              </Button>
              <Button type="button" variant="ghost" className="w-full text-zinc-400 hover:text-white hover:bg-zinc-800" onClick={() => setFlipped(false)}>
                {backButtonText}
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>
    </div>
  )
}
