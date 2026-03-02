import React from 'react';
import { cn } from '@/lib/utils';
import { motion, HTMLMotionProps } from 'framer-motion';

interface MagicCardProps extends HTMLMotionProps<"div"> {
    children: React.ReactNode;
    className?: string;
    gradient?: string;
    hoverEffect?: boolean;
}

export const MagicCard: React.FC<MagicCardProps> = ({
    children,
    className,
    gradient,
    hoverEffect = true,
    ...props
}) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className={cn(
                "relative overflow-hidden rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-lg shadow-xl",
                "text-white",
                hoverEffect && "hover:border-white/40 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300",
                className
            )}
            style={{
                background: gradient || undefined
            }}
            {...props}
        >
            {/* Ambient Light/Glow Effect */}
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/30 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-purple-500/30 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10">
                {children}
            </div>
        </motion.div>
    );
};
